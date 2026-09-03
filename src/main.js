import { back, confirmSelection, moveSelection, moveSubSelection } from './ui/docked';
// @ifdef DEBUG
import {
  bindDebug,
  debugCrafts,
  lights,
  renderDebug,
  renderDebugDemos,
} from './debug';
// @endif
import { bindKeys, initKeys } from './keyboard';
import { camera, centerCamera, followTarget } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualMd } from './modules';
import { dock, dockAt, launch } from './docking';
import { insidePath, traceBeam } from './prism';
import { playerShip, updatePlayer } from './player';
import { renderBlasts, updateBlasts } from './explosion';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { GameLoop } from './game-loop';
import { Item } from './item';
// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';
// @endif
import { colors } from './colors';
import { detectCollisions } from './collisions';
import { game } from './game';
import { generateWorld } from './world';
import { itemTypes } from './items';
// Kept with the single imports because this position compresses smaller.
// eslint-disable-next-line sort-imports
import { grind, mine } from './mining';
// import { Road } from './road';
import { renderBackground } from './background';
import { renderCraft } from './craft-render';
import { renderUI } from './ui';
import { resolve } from './resolve';
import { scoop } from './scoop';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
// @ifdef BENCHMARK
import { testSections } from './section-test';
// @endif

setSizing(game);

window.onresize = () => setSizing(game);

horn.shades = colors.yellow;
thrusterDualMd.shades = cargoScoop.shades = shield.shades = colors.violet;
[thrusterDualMd, cargoScoop, cargoScoop, horn, shield, floodlight]
  .forEach((module) => playerShip.fit(module));

dockingBay.shades = colors.green;

const world = generateWorld(13312);
const stations = world.stations.map((properties) => {
  const station = new Craft({ ...properties, craftData: stationTypes.corral, shades: colors.white });

  station.fit(dockingBay);

  return station;
});

// Closest-to-center first, so the player can start at any of the nearest few
// without every player landing at the same one
stations.sort((a, b) => a.x ** 2 + a.y ** 2 - b.x ** 2 - b.y ** 2);

dockAt(playerShip, stations[Math.floor(Math.random() * 8)]);
launch(playerShip);

world.wrecks.forEach((properties) => new Craft({
  ...properties,
  craftData: shipTypes.mustang,
  shades: colors.orange,
}));

world.fields.flatMap(({ asteroids }) => asteroids).forEach((properties) => {
  const object = new Asteroid({ ...properties, contents: [] });

  properties.contents.forEach((resource) =>
    object.bury(new Item({ itemData: itemTypes[resource] })));
});

// @ifdef DEBUG
debugCrafts(game);
// @endif

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  Object.assign(playerShip, {
    launching: 0,
    x: world.fields[0].x,
    y: world.fields[0].y,
  });
}
// @endif

// @ifdef BENCHMARK
window['testSections'] = () => testSections(
  game.sprites.filter(({ scenery }) => scenery), playerShip, lamp);
// @endif

// The player's lamp, kept to hand so what it is picking out can be worked out
// once a frame rather than hunted for in the segments every time
const lamp = playerShip.segments.find((segment) => segment.module === floodlight);
const activeRadius = 2000;
const nearbyRadius = 100;
const nearbySteps = 4;
let activeSprites = [];
let nearbySprites = [];
let updates = 0;
let spriteCount;

initKeys();

[cargoScoop, horn, shield, floodlight].forEach((module) =>
  bindKeys(module.key[0], () => playerShip.toggle(module)));
bindKeys('ft', () => playerShip.dockedTo && moveSubSelection(-1, playerShip));
bindKeys('pe', () => playerShip.dockedTo && back(playerShip));
[' '].forEach((key) =>
  bindKeys(key, () => playerShip.dockedTo && confirmSelection(playerShip)));
bindKeys('ht', () => playerShip.dockedTo && moveSubSelection(1, playerShip));
bindKeys('Up', () => playerShip.dockedTo && moveSelection(-1, playerShip));
bindKeys('wn', () => playerShip.dockedTo && moveSelection(1, playerShip));

// @ifdef DEBUG
bindDebug(game);
// @endif

centerCamera(game, playerShip);

GameLoop({
  render: () => {
    // The sky slides past at its own pace, so it moves itself
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noBackground')) {
    // @endif
      renderBackground(game);
    // @ifdef BENCHMARK
    }
    // @endif

    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);

    // roads.forEach((road) => road.render());
    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them, using the same z-index as ship modules
    for (let zIndex = -3; zIndex < 4; zIndex++) {
      activeSprites
        .filter((object) => object.scenery && object.zIndex === zIndex)
        .forEach((object) => {
          object.render();
          // A loose leaf cannot be mined any smaller, so its cargo stays in view.
          object.sections || object.contents.forEach((item) => item.render());
        });

      if (zIndex === -2) {
        // Cargo still inside mineable asteroids shows only through the slice
        // the floodlight is crossing, as if the lamp lets a pilot peer inside
        // @ifdef DEBUG
        if (lights) {
          // @endif
          if (lamp.activationProgress > 0.5) {
            const beam = traceBeam(playerShip, lamp, activeSprites);
            const worldFrame = game.ctx.getTransform();

            game.ctx.save();
            game.ctx.translate(playerShip.x, playerShip.y);
            game.ctx.rotate(playerShip.rotation);
            game.ctx.translate(lamp.x, lamp.y);
            game.ctx.clip(insidePath(beam));
            game.ctx.clip(beam.mask);
            game.ctx.setTransform(worldFrame);

            activeSprites.forEach((asteroid) =>
              asteroid.scenery && asteroid.sections &&
              asteroid.contents.forEach((item) => item.render()));

            game.ctx.restore();
          }
        // @ifdef DEBUG
        }
        // @endif

        activeSprites.forEach((item) =>
          item.item && !item.buried && !item.dead && item.render());
      }

      activeSprites.forEach((craft) =>
        craft.segments && !craft.dead && renderCraft(craft, activeSprites, zIndex));
    }

    // Sparks off the horn sit over the asteroids and ships they come off
    renderSparks(game.ctx);

    // Light rather than paint, so it goes over everything it lights up
    // @ifdef DEBUG
    if (lights) {
    // @endif
      renderBlasts(game.ctx);
    // @ifdef DEBUG
    }
    // @endif

    game.ctx.restore();

    // @ifdef DEBUG
    renderDebug(game, activeSprites, nearbyRadius);
    renderDebugDemos(game);
    // @endif

    renderUI(game, stations);
  },
  update: (dt) => {
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

    updateBlasts(dt);
    updateSparks(dt);
    updatePlayer(dt);

    activeSprites.forEach((sprite) =>
      !sprite.dead && !nearbySprites.includes(sprite) && sprite.update(dt));

    const spriteContacts = detectCollisions(activeSprites);
    const mined = mine(spriteContacts);

    scoop(spriteContacts);
    dock(spriteContacts);
    resolve(spriteContacts);

    // Things that happen four times per update (~240 FPS): the nearby tier gets
    // four smaller movements and collision passes, preserving one dt in total.
    for (let step = nearbySteps; step--;) {
      nearbySprites.forEach((sprite) => !sprite.dead && sprite.update(dt / nearbySteps));
      resolve(detectCollisions(nearbySprites));
    }

    mined.forEach(grind);
    followTarget(game, playerShip, dt);
  },
}).start();
