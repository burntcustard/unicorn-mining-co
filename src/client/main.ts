import { Craft } from '../shared/craft/craft';
import { Station } from '../shared/craft/station';
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
import { bindKeys, initKeys, playerInput } from './input';
import { network } from './network';
import { camera, dockDuration, followTarget } from './camera';

import { insidePath, traceBeam } from './prism';
import { itemTypes, Message } from '../shared/items';
import { adoptPlayerShip, playerShip, updatePlayer } from './player';
import { renderSparks, updateSparks } from './shrapnel';
import { presentEvents } from './present-events';
import { GameLoop } from './game-loop';
import { Ship } from '../shared/craft/ship';
import { CargoScoop, Horn, Shield, Light } from '../shared/modules';
import { createRenderedShip } from './create-rendered-ship';
import { decorateGameObject } from './game-object';
import './craft/station';

// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';

// @endif
import { colors } from '../shared/colors';
import { game } from './game';

// import { Road } from './road';
import { Asteroid } from '../shared/simulation/asteroid';

import { renderAsteroid } from './render-asteroid';
import { createRenderedItem } from './create-rendered-item';
import { renderItem } from './render-item';
import { Item } from '../shared/items/item';
import { playSound } from './sound-loader';
import { updateDrillSounds } from './update-drill-sounds';
import { renderUI } from './ui';
import { setSizing } from './set-sizing';
import { Vector, type Vector as VectorValue } from '../shared/vector';
import { type WorldObject } from '../shared/types';
import { type WorldObject as SimulationObject } from '../shared/simulation/world';

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

const materialize = ({ entity }: { entity: SimulationObject }) => {
  let object: WorldObject;
  if (entity instanceof Craft) {
    object = decorateGameObject({ sprite: entity });
  } else if (entity instanceof Item) object = renderItem({ item: entity });
  else if (entity instanceof Asteroid)
    object = renderAsteroid({ asteroid: entity });
  else object = decorateGameObject({ sprite: entity });
  object.networked = 1;
  regionalObjects.set(entity.id, object);
  return object;
};

const refreshReplication = () => {
  stationMarkers = [...network.world.entities.values()].filter(
    (entity) => entity instanceof Station,
  );
  const entities = [...network.world.entities.values()];
  const wanted = new Set(entities.map(({ id }) => id));
  entities.forEach((entity) => {
    const old = regionalObjects.get(entity.id);
    if (old !== entity) {
      old?.remove();
      spriteCount = -1;
      materialize({ entity });
    }
  });
  [...regionalObjects].forEach(([id, object]) => {
    if (!wanted.has(id)) {
      object.remove();
      regionalObjects.delete(id);
    }
  });
};

const syncPlayerShip = () => {
  const ship = network.world.entities.get(network.shipId!);
  if (!(ship instanceof Ship)) return;
  if (playerShip !== ship) {
    refreshReplication();
    adoptPlayerShip({ ship });
  }
};

const syncSimulationObjects = (dt: number) => {
  refreshReplication();
  regionalObjects.forEach((object) => {
    if (object instanceof Craft && object !== playerShip)
      object.updateVisual(dt);
  });
};

// @ifdef DEBUG
const debugWreck = createRenderedShip({
  shades: colors.orange,
  position: playerShip.position.add(Vector(500)),
});
const debugNote = createRenderedItem({ resource: itemTypes.indexOf(Message) });

debugNote.message = 'REGION 0/0';

debugNote.unlock = 'ORANGE';
debugNote.remove();
debugWreck.cargoContents.push(debugNote);

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

[CargoScoop, Horn, Shield, Light].forEach((module) =>
  bindKeys(module.label[0].toLowerCase(), () => {
    if (playerShip.launching || playerShip.dockedTo) return;
    const segment = playerShip.segments.find(
      (segment) =>
        segment.module.constructor === module && segment.mount.health > 0,
    );

    if (!segment || playerShip.dead) return;
    if (module === Shield) playSound(segment.active ? 6 : 7);
    if (module === Light) playSound(9);
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
    const remotePoses = network.remoteMotion.sample({
      world: network.world,
      shipId: network.shipId,
    });

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
        // the Light is crossing, as if the lamp lets a pilot peer inside
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
          craft.segments &&
          !craft.dead &&
          craft.render({
            scenery: activeSprites,
            zIndex,
            pose: remotePoses.get(craft.id),
          }),
      );
    }

    // Sparks off the Horn sit over the asteroids and ships they come off
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
    presentEvents({ events: network.takeEvents(), playerId: network.playerId });
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
    updateDrillSounds({ crafts: game.crafts });
    game.crafts.forEach((craft) => {
      if (!craft.render) decorateGameObject({ sprite: craft as Craft });
    });
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
