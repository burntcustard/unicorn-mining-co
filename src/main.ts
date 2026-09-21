import {
  back,
  confirmSelection,
  moveSelection,
  moveSubSelection,
} from './ui/docked-loader';
// @ifdef DEBUG
import {
  bindDebug,
  debugCrafts,
  lights,
  renderDebug,
  renderDebugDemos,
} from './debug';
// @endif
import { bindKeys, initKeys, playerInput } from './client/input';
import { network } from './client/network';
import { camera, dockDuration, followTarget } from './camera';
import { cargoScoop, floodlight, horn, shield } from './modules';
import { insidePath, traceBeam } from './prism';
import { itemTypes, message } from './items';
import { fitStarterModules, playerShip, updatePlayer } from './player';
import { renderSparks, updateSparks } from './shrapnel';
import { GameLoop } from './game-loop';
import { Item } from './item';
import { Ship } from './ship';
import { Station } from './station';
// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';
// @endif
import { colors } from './colors';
import { game } from './game';
// import { Road } from './road';
import { Asteroid as SimulationAsteroid } from './shared/simulation/asteroid';
import { renderAsteroid } from './client/render/asteroid';
import { renderItem } from './client/render/item';
import { Item as SimulationItem } from './shared/simulation/item';
import { playSound } from './sound-loader';
import { renderUI } from './ui';
import { setSizing } from './set-sizing';
import { Vector, type Vector as VectorValue } from './vector';
import { type Module, type WorldObject } from './types';
import { type Entity } from './shared/protocol/entities';

type Background = {
  renderBackground: (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    scale: number,
    x: number,
    y: number,
  ) => void;
};

let gameStarted = false;
const background = (
  globalThis as typeof globalThis & { background: Background }
).background;
const renderSky = () =>
  background.renderBackground(
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

const regionalObjects = new Map<number, WorldObject>();
let stationMarkers: { position: VectorValue; radius: number }[] = [];
let syncedCargo = '';

const materialize = ({ entity }: { entity: Entity }) => {
  let object: WorldObject;

  if (entity.kind === 'station') {
    object = new Station({
      ...entity,
      position: entity.position.add(Vector()),
      shades: colors.white,
    });
  } else if (entity.kind === 'ship') {
    const wreck = new Ship({
      cargo: entity.cargo,
      health: entity.health,
      id: entity.id,
      mass: entity.mass,
      position: entity.position.add(Vector()),
      radius: entity.radius,
      rotation: entity.rotation,
      spin: entity.spin,
      shades: [
        colors.yellow,
        colors.green,
        colors.cyan,
        colors.red,
        colors.orange,
      ][entity.paint || 0],
      velocity: entity.velocity,
    });

    if (entity.playerId !== undefined) fitStarterModules(wreck);

    entity.cargo?.forEach((resource) => {
      const gem = new Item({ itemData: itemTypes[resource] });

      gem.remove();
      wreck.cargo.push(gem);
    });
    object = wreck;
  } else if (entity.kind === 'item') {
    object = renderItem({ item: entity as SimulationItem });
  } else {
    object = renderAsteroid({ asteroid: entity as SimulationAsteroid });
  }

  object.networked = 1;
  regionalObjects.set(entity.id, object);
  return object;
};

const refreshReplication = () => {
  stationMarkers = [...network.stationMarkers.values()].map((marker) => ({
    ...marker,
    position: Vector(marker.position.x, marker.position.y),
  }));
  const entities = [...network.world.entities.values()].filter(
    ({ id }) => id !== network.shipId,
  );
  const wanted = new Set(entities.map(({ id }) => id));

  entities.forEach((entity) => {
    const rendered = regionalObjects.get(entity.id);

    if (
      !rendered ||
      ((entity.kind === 'asteroid' || entity.kind === 'item') &&
        rendered !== entity)
    ) {
      rendered?.remove();
      materialize({ entity });
    }
  });
  [...regionalObjects].forEach(([id, object]) => {
    if (!wanted.has(id) && playerShip.dockedTo !== object) {
      object.remove();
      regionalObjects.delete(id);
    }
  });
};

const syncPlayerShip = () => {
  const entity = network.shipId
    ? network.world.entities.get(network.shipId)
    : undefined;

  if (entity?.kind !== 'ship') return;
  playerShip.position.set(entity.position);
  playerShip.velocity.set(entity.velocity);
  playerShip.rotation = entity.rotation;
  playerShip.spin = entity.spin;
  playerShip.launching = entity.launching || 0;
  playerShip.fly(entity.thrust, entity.turn);
  playerShip.dockedTo = entity.dockedTo
    ? regionalObjects.get(entity.dockedTo)
    : 0;

  const cargo = entity.cargo || [];
  const cargoKey = cargo.join(',');

  if (cargoKey !== syncedCargo) {
    playerShip.cargo.forEach((item) => item.remove());
    playerShip.cargo = cargo.map((resource) => {
      const item = new Item({ itemData: itemTypes[resource] });

      item.remove();
      return item;
    });
    syncedCargo = cargoKey;
  }
};

const syncSimulationObjects = (dt: number) => {
  [...regionalObjects].forEach(([id, object]) => {
    const entity = network.world.entities.get(id);

    if (!entity) return;
    if (entity.kind === 'ship' && object instanceof Ship) {
      // Remote ships extrapolate in the shared simulation. Ease their rendered
      // copy towards each fresh authoritative path instead of visibly snapping.
      const correction = 1 - Math.exp(-18 * dt);
      const angle =
        ((entity.rotation - object.rotation + Math.PI * 3) % (Math.PI * 2)) -
        Math.PI;

      object.position.set(
        object.position.add(
          entity.position.subtract(object.position).scale(correction),
        ),
      );
      object.velocity.set(entity.velocity);
      object.rotation += angle * correction;
      object.spin = entity.spin;
      object.fly(entity.thrust, entity.turn);
      object.segments.forEach((segment) => {
        const type = segment.module.oneOf;

        if (type === cargoScoop) segment.active = Number(entity.hatch);
        else if (type === horn) segment.active = Number(entity.drill);
        else if (type === shield) segment.active = Number(entity.shield);
        else if (type === floodlight) segment.active = Number(entity.light);
      });
      const hulls = object.segments.filter(({ hull }) => hull);
      const surviving = Math.ceil(
        hulls.length * Math.max(0, Math.min(1, entity.health / 100)),
      );

      hulls.forEach((segment, index) => {
        segment.health = index < surviving ? segment.module.health : 0;
      });
      object.updateVisual(dt);
    } else {
      object.position.set(entity.position);
      object.velocity.set(entity.velocity);
      object.rotation = entity.rotation;
      object.spin = entity.spin;
      if (entity.kind === 'asteroid') object.health = entity.health;
    }
  });
};

// @ifdef DEBUG
const debugWreck = new Ship({
  shades: colors.orange,
  position: playerShip.position.add(Vector(500)),
});
const debugNote = new Item({
  itemData: message,
  message: 'REGION 0/0',
});

debugNote.unlock = 'ORANGE';
debugNote.remove();
debugWreck.cargo.push(debugNote);

// @ifdef DEBUG
debugCrafts(game);
// @endif

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  Object.assign(playerShip, {
    dockedTo: 0,
    launching: 0,
    started: 1,
    position: Vector(),
  });
}
// @endif

// @ifdef DEBUG
// Lets the console (and automated checks) watch the clock the client is
// predicting on against the last tick the server reported.
Object.assign(window, { game, network, playerShip });
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
    const segment = playerShip.segments.find(
      (segment) => segment.module.oneOf === module && segment.mount.health > 0,
    );

    playerShip.toggle(module);
    if (!segment || playerShip.dead) return;
    if (module === shield) playSound(segment.active ? 6 : 7);
    if (module === floodlight) playSound(9);
  }),
);
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
          object.sections ||
            object.renderContents?.forEach((item: WorldObject) =>
              item.render(),
            );
        });

      if (zIndex === -2) {
        // Cargo still inside mineable asteroids shows only through the slice
        // the floodlight is crossing, as if the lamp lets a pilot peer inside
        // @ifdef DEBUG
        if (lights) {
          // @endif
          const lamp = playerShip.segments.find(
            (segment) => segment.module.beam,
          );

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

            activeSprites.forEach(
              (asteroid) =>
                asteroid.scenery &&
                asteroid.sections &&
                asteroid.renderContents?.forEach((item: WorldObject) =>
                  item.render(),
                ),
            );

            ctx.restore();
          }
          // @ifdef DEBUG
        }
        // @endif

        activeSprites.forEach(
          (item) => item.item && !item.buried && !item.dead && item.render(),
        );
      }

      activeSprites.forEach(
        (craft) =>
          craft.segments && !craft.dead && craft.render(activeSprites, zIndex),
      );
    }

    // Sparks off the horn sit over the asteroids and ships they come off
    renderSparks(ctx);

    ctx.restore();

    // @ifdef DEBUG
    renderDebug(game, activeSprites, nearbyRadius);
    renderDebugDemos(game);
    // @endif

    renderUI(game, stationMarkers);
  },
  update: (dt: number) => {
    if (playerShip.launchRequested) {
      playerInput.launch = true;
      playerShip.launchRequested = 0;
    }
    network.update({ input: playerInput });
    syncSimulationObjects(dt);
    syncPlayerShip();

    // Things that happen every fourth update (~15 FPS), or as soon as sprites
    // come or go, so shipwreck fragments are not left out: refresh the active tier.
    if (!(updates++ % 4) || spriteCount !== game.sprites.length) {
      refreshReplication();
      spriteCount = game.sprites.length;
      activeSprites = game.sprites.filter(
        (sprite) =>
          !sprite.dead &&
          sprite.position.distanceTo(playerShip.position) <= activeRadius,
      );
    }

    // Things that happen every update (~60 FPS).
    nearbySprites = activeSprites.filter(
      (sprite) =>
        !sprite.dead &&
        sprite.position.distanceTo(playerShip.position) <= nearbyRadius,
    );

    updateSparks(dt);
    updatePlayer(dt);
    playerShip.updateVisual(dt);
    if (game.uiVisible) game.uiAlpha = Math.min(1, game.uiAlpha + 2 * dt);

    activeSprites.forEach(
      (sprite) =>
        !sprite.dead &&
        !sprite.networked &&
        !nearbySprites.includes(sprite) &&
        sprite.update(dt),
    );

    // Things that happen four times per update (~240 FPS): the nearby tier gets
    // four smaller movements and collision passes, preserving one dt in total.
    for (let step = 4; step--;) {
      nearbySprites.forEach(
        (sprite) => !sprite.dead && !sprite.networked && sprite.update(dt / 4),
      );
    }

    followTarget(game, playerShip, dt);
  },
});

// Let the inline sky settle before the game reveals its real starting place.
setTimeout(() => {
  void network.ready.then(() => {
    refreshReplication();
    syncPlayerShip();
    playerShip.started = 1;
    gameStarted = true;
    gameLoop.start();
    // Keep the camera transition clear before bringing the HUD into view.
    setTimeout(() => (game.uiVisible = 1), dockDuration * 1000);
  });
});
