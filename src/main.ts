import { back, confirmSelection, moveSelection, moveSubSelection } from './ui/docked-loader';
// @ifdef DEBUG
import {
  bindDebug,
  debugCrafts,
  lights,
  renderDebug,
  renderDebugDemos,
} from './debug';
// @endif
import { bindKeys, bindStart, initKeys } from './keyboard';
import { camera, dockDuration, followTarget } from './camera';
import { cargoScoop, floodlight, horn, shield } from './modules';
import { dock, dockAt, launch } from './docking';
import { insidePath, traceBeam } from './prism';
import { itemTypes, message } from './items';
import { playerShip, updatePlayer } from './player';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { GameLoop } from './game-loop';
import { Item } from './item';
import { Ship } from './ship';
import { Station } from './station';
// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';
// @endif
import { colors } from './colors';
import { detectCollisions } from './collisions';
import { game } from './game';
import { generateWorld } from './world';
// Kept with the single imports because this position compresses smaller.
// eslint-disable-next-line sort-imports
import { grind, mine } from './mining';
// import { Road } from './road';
import { playSound } from './sound-loader';
import { renderUI } from './ui';
import { resolve } from './resolve';
import { scoop } from './scoop';
import { setSizing } from './set-sizing';
import { Vector, type Vector as VectorValue } from './vector';
import { type Module, type WorldObject } from './types';
// @ifdef BENCHMARK
import { testSections } from './section-test';
// @endif

type WorldBlueprint = {
  [key: string]: any;
  cargo: number[];
  contents: number[];
  position: VectorValue;
};

type Background = {
  renderBackground: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
    scale: number, x: number, y: number) => void;
};

let gameStarted = false;
const background = (globalThis as typeof globalThis & { background: Background }).background;
const renderSky = () => background.renderBackground(
  game.canvas,
  game.ctx,
  game.scale,
  camera.x,
  camera.y,
);

setSizing(game);
renderSky();

window.onresize = () => {
  setSizing(game);
  gameStarted || renderSky();
};

const world = generateWorld(25);
const stations = world.stations.map((properties) =>
  new Station({ ...properties, shades: colors.white }));

// Closest-to-center first, so the player can start at any of the nearest few
// without every player landing at the same one
stations.sort((a, b) => a.position.length() ** 2 - b.position.length() ** 2);

const startingStation = stations[Math.floor(Math.random() * 3)];

world.wrecks.forEach((properties) => {
  const wreck = new Ship(properties);

  properties.cargo.forEach((resource: number) => {
    const gem = new Item({ itemData: itemTypes[resource] });

    gem.remove();
    wreck.cargo.push(gem);
  });

  if (properties.message) {
    const note = new Item({
      itemData: { ...message, shades: properties.shades },
      message: properties.message,
    });

    // Orange slates unlock paint first, then reveal their field on later pickups.
    if (properties.shades === colors.orange) note.unlock = 'ORANGE';
    note.remove();
    wreck.cargo.push(note);
  }
});

// @ifdef DEBUG
const debugWreck = new Ship({
  shades: colors.orange,
  position: playerShip.position.add(Vector(500)),
});
const debugNote = new Item({ itemData: message, message: world.wrecks[4].message });

debugNote.unlock = 'ORANGE';
debugNote.remove();
debugWreck.cargo.push(debugNote);

// A pocket of the smallest, violet-outlined rocks makes the amethyst field
// behaviour easy to inspect without flying to its far-off generated field.
[
  [-180, -130], [60, -150], [250, -50],
  [-100, 100], [140, 120], [350, 120],
].forEach(([x, y], i) => {
  const asteroid = new Asteroid({
    contents: [],
    points: 6,
    radius: 100,
    radiusEven: 25,
    rotation: i,
    fill: `${colors.purple[1]}9`,
    stroke: colors.violet[2],
    position: playerShip.position.add(Vector(900 + x, y)),
  });

  asteroid.bury(new Item({ itemData: itemTypes[1] }));
});
// @endif

world.fields.forEach(({ asteroids }: { asteroids: WorldBlueprint[] }) =>
  asteroids.forEach((properties: WorldBlueprint) => {
  const object = new Asteroid({ ...properties, contents: [] });

  properties.contents.forEach((resource: number) =>
    object.bury(new Item({ itemData: itemTypes[resource] })));
  }));

// @ifdef DEBUG
debugCrafts(game);
// @endif

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  Object.assign(playerShip, {
    dockedTo: 0,
    launching: 0,
    started: 1,
    position: world.fields[0].position.add(Vector()),
  });
}
// @endif

// @ifdef BENCHMARK
Object.assign(window, { testSections: () => testSections(
  game.sprites.filter(({ scenery }) => scenery) as Asteroid[], playerShip) });
// @endif

const activeRadius = 2000;
const nearbyRadius = 100;
let activeSprites: WorldObject[] = [];
let nearbySprites: WorldObject[] = [];
let updates = 0;
let spriteCount = 0;

initKeys();

([cargoScoop, horn, shield, floodlight] as Module[]).forEach((module) =>
  bindKeys(module.name[0].toLowerCase(), () => {
    if (playerShip.launching || playerShip.dockedTo) return;
    const segment = playerShip.segments.find((segment) =>
      segment.module.oneOf === module && segment.mount.health > 0);

    playerShip.toggle(module);
    if (!segment || playerShip.dead) return;
    if (module === shield) playSound(segment.active ? 6 : 7);
    if (module === floodlight) playSound(9);
  }));
bindStart(() => gameStarted && !playerShip.started && launch(playerShip));
bindKeys('ft', () => playerShip.dockedTo && moveSubSelection(-1, playerShip));
bindKeys('pe', () => playerShip.dockedTo && back(playerShip));
bindKeys(' ', () => playerShip.dockedTo && confirmSelection(playerShip));
bindKeys('ht', () => playerShip.dockedTo && moveSubSelection(1, playerShip));
bindKeys('Up', () => playerShip.dockedTo && moveSelection(-1, playerShip));
bindKeys('wn', () => playerShip.dockedTo && moveSelection(1, playerShip));

// @ifdef DEBUG
bindDebug(game);
// @endif

const gameLoop = GameLoop({
  render: () => {
    // The sky slides past at its own pace, so it moves itself
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noBackground')) {
    // @endif
      renderSky();
    // @ifdef BENCHMARK
    }
    // @endif

    const { ctx, scale } = game;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    // roads.forEach((road) => road.render());
    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them, using the same z-index as ship modules
    // The half layer puts every thruster glow above every flare, below hulls.
    for (const zIndex of [-3, -2, -1, -0.5, 0, 1, 2, 3]) {
      activeSprites
        .filter((object) => object.scenery && object.zIndex === zIndex)
        .forEach((object) => {
          object.render();
          // A loose leaf cannot be mined any smaller, so its cargo stays in view.
          object.sections || object.contents.forEach((item: WorldObject) => item.render());
        });

      if (zIndex === -2) {
        // Cargo still inside mineable asteroids shows only through the slice
        // the floodlight is crossing, as if the lamp lets a pilot peer inside
        // @ifdef DEBUG
        if (lights) {
          // @endif
          const lamp = playerShip.segments.find((segment) => segment.module.beam);

          if (lamp?.activationProgress > 0.5) {
            const beam = traceBeam(playerShip, lamp, activeSprites);

            ctx.save();
            ctx.translate(playerShip.position.x, playerShip.position.y);
            ctx.rotate(playerShip.rotation);
            ctx.translate(lamp.localPosition.x, lamp.localPosition.y);
            ctx.clip(insidePath(beam));
            ctx.clip(beam.mask);
            ctx.resetTransform();
            ctx.scale(scale, scale);
            ctx.translate(-camera.x, -camera.y);

            activeSprites.forEach((asteroid) =>
              asteroid.scenery && asteroid.sections &&
              asteroid.contents.forEach((item: WorldObject) => item.render()));

            ctx.restore();
          }
        // @ifdef DEBUG
        }
        // @endif

        activeSprites.forEach((item) =>
          item.item && !item.buried && !item.dead && item.render());
      }

      activeSprites.forEach((craft) =>
        craft.segments && !craft.dead && craft.render(activeSprites, zIndex));
    }

    // Sparks off the horn sit over the asteroids and ships they come off
    renderSparks(ctx);

    ctx.restore();

    // @ifdef DEBUG
    renderDebug(game, activeSprites, nearbyRadius);
    renderDebugDemos(game);
    // @endif

    renderUI(game, stations);
  },
  update: (dt: number) => {
    // Things that happen every fourth update (~15 FPS), or as soon as sprites
    // come or go, so shipwreck fragments are not left out: refresh the active tier.
    if (!(updates++ % 4) || spriteCount !== game.sprites.length) {
      spriteCount = game.sprites.length;
      activeSprites = game.sprites.filter((sprite) =>
        !sprite.dead && sprite.position.distanceTo(playerShip.position) <= activeRadius);
    }

    // Things that happen every update (~60 FPS).
    nearbySprites = activeSprites.filter((sprite) =>
      !sprite.dead && sprite.position.distanceTo(playerShip.position) <= nearbyRadius);

    updateSparks(dt);
    updatePlayer(dt);
    if (game.uiVisible) game.uiAlpha = Math.min(1, game.uiAlpha + 2 * dt);

    activeSprites.forEach((sprite) =>
      !sprite.dead && !nearbySprites.includes(sprite) && sprite.update(dt));

    const spriteContacts = detectCollisions(activeSprites);
    const mined = mine(spriteContacts);

    scoop(spriteContacts);
    dock(spriteContacts);
    resolve(spriteContacts);

    // Things that happen four times per update (~240 FPS): the nearby tier gets
    // four smaller movements and collision passes, preserving one dt in total.
    for (let step = 4; step--;) {
      nearbySprites.forEach((sprite) => !sprite.dead && sprite.update(dt / 4));
      resolve(detectCollisions(nearbySprites));
    }

    mined.forEach(grind);
    followTarget(game, playerShip, dt);
  },
});

// Let the inline sky settle before the game reveals its real starting place.
setTimeout(() => {
  dockAt(playerShip, startingStation);
  gameStarted = true;
  gameLoop.start();
  // Keep the camera transition clear before bringing the HUD into view.
  setTimeout(() => game.uiVisible = 1, dockDuration * 1000);
});
