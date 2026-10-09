import { ui } from './ui/dom/ui';
import { syncDockedUi } from './ui/dom/docked-loader';
import { renderingLayers } from '../specs/rendering-layers';
import { init } from './core';
import { dockDuration } from '../specs/camera';
import * as Vec from './utilities/vector';
import { Craft } from './objects/craft';
import { Projectile } from './objects/projectile';
import { Station } from './objects/station';

// @ifdef DEBUG
import {
  bindDebug,
  debugCrafts,
  lights,
  renderDebug,
  renderDebugDemos,
} from './debug/debug';

// @endif
import { bindAction, initKeys, playerInput, setMenuInput } from './input/input';
import { moduleBinding } from './input/keybindings';
import { network } from './network/network';
import { camera, centerCamera, followTarget, zoomCamera } from './camera';

import { revealBuriedItems } from './utilities/lighting';
import { message as messageSpec } from '../specs/items';
import { adoptPlayerShip, player, readSlate, updatePlayer } from './player';
import { renderSparks, updateSparks } from './effects/shrapnel';
import { renderEffects, updateEffects } from './effects/effect';
import { presentEvents } from './effects/present-events';
import { GameLoop } from './game-loop';
import { Ship } from './objects/ship';
import { SearchLight } from './objects/modules/index';
import { moduleControls } from './objects/control-ship';

// @ifdef BENCHMARK
import { benchmarkFlag } from './debug/benchmark';

// @endif
import { colors, paintColors } from '../specs/colors';
import { type Identity } from './ui/dom/identity';
import { game } from './game';

import { Item } from './objects/item';

import { playSound } from './audio/sound-loader';
import { updateHornDrillSounds } from './audio/update-horn-drill-sounds';
import { renderUI } from './ui/ui';
import { setSizing } from './ui/set-sizing';
import { type GameObject as SimulationObject } from './objects/game-object';

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

const { canvas, context } = init();

Object.assign(game, { canvas, ctx: context });
setSizing(game);
renderSky();

window.onresize = () => {
  setSizing(game);
  gameStarted || renderSky();
};

window.addEventListener('ui-graphics', () => setSizing(game));
window.addEventListener('ui-navigation', () =>
  setMenuInput(Boolean(ui.current)),
);

window.addEventListener('keydown', (event) => {
  if (!ui.current) zoomCamera(game, event);

  if (event.defaultPrevented && !gameStarted) renderSky();
});

const regionalObjects = new Map<number, SimulationObject>();

let stationMarkers: { position: Vec.Value; radius: number }[] = [];

const materialize = ({ entity }: { entity: SimulationObject }) => {
  const object = entity.addToScene();

  object.networked = 1;
  regionalObjects.set(entity.id, object);
  return object;
};

const refreshReplication = () => {
  const entities = [...network.world.entities.values()];

  stationMarkers = entities.filter((entity) => entity instanceof Station);
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

  if (player.ship !== ship) {
    refreshReplication();
    adoptPlayerShip({ ship });
  }
};

const syncSimulationObjects = (dt: number) => {
  regionalObjects.forEach((object) => {
    if (object instanceof Craft && object !== player.ship) {
      object.updateVisual(dt);
    }
  });
};

// @ifdef DEBUG
const debugWreck = new Ship({
  shades: colors.orange,
  position: Vec.add(player.ship.position, Vec.create(500)),
}).addToScene();

const debugNote = new Item(messageSpec).addToScene();

debugNote.message = 'REGION 0/0';

debugNote.unlock = 'ORANGE';
debugNote.remove();
debugWreck.cargoContents.push(debugNote);

// @ifdef DEBUG
debugCrafts(game);
// @endif

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  player.started = true;

  Object.assign(player.ship, {
    dockedTo: 0,
    launching: 0,
    position: Vec.create(),
  });
}
// @endif

// @ifdef DEBUG
// Lets the console (and automated checks) watch the clock the client is
// predicting on against the last tick the server reported.
Object.assign(window, { game, network, player });
// @endif

const activeRadius = 2000;
let activeSprites: SimulationObject[] = [];
let activeTime = 0;
let spriteCount = 0;

initKeys({
  onChange: (input) => network.recordInput({ input }),
  onKeyDown: ({ key }) => {
    if (
      !network.shipDestroyed &&
      !(network.shipStranded && key.toLowerCase() === 'r')
    ) {
      return false;
    }

    network.requestRespawn();
    return true;
  },
});

setMenuInput(Boolean(ui.current));

moduleControls.forEach(({ Type, input: action }) =>
  bindAction(moduleBinding(action), () => {
    if (player.ship.launching || player.ship.dockedTo) return;
    const segment = player.ship.segments.find(
      (segment) => segment.module instanceof Type && segment.mount.health > 0,
    );

    if (!segment || player.ship.dead) return;

    if (action === 'shieldGenerator') playSound(segment.active ? 6 : 7);

    if (Type === SearchLight) playSound(9);
  }),
);

// @ifdef DEBUG
bindDebug(game);
// @endif

const gameLoop = GameLoop({
  render: ({ dt, now }) => {
    const predicted = network.predictFrame({ now });

    const remotePoses = network.remoteMotion.sample({
      now,
      world: network.world,
      predicted,
      shipId: network.shipId,
    });

    const predictedPlayerShip = predicted.entities.get(player.ship.id);
    const renderedShip =
      predictedPlayerShip instanceof Ship ? predictedPlayerShip : player.ship;
    const playerPose = remotePoses.get(player.ship.id) || renderedShip;

    if (!network.shipDestroyed) {
      followTarget(
        game,
        { position: playerPose.position, dockedTo: player.ship.dockedTo },
        dt,
      );
    }
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

    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them. Thruster glows sit above flares, below hulls.
    for (const zIndex of Object.values(renderingLayers)) {
      activeSprites
        .filter((object) => object.scenery && object.zIndex === zIndex)
        .forEach((object) => {
          object.render({ pose: remotePoses.get(object.id) });
          // A loose leaf cannot be split any smaller, so its cargo stays in view.
          object.segments ||
            object.renderContents?.forEach((item: SimulationObject) =>
              item.render(),
            );
        });

      if (zIndex === renderingLayers.scenery) {
        // Cargo still inside asteroids with contents shows only through the slice
        // the SearchLight is crossing, as if the lamp lets a pilot peer inside
        // @ifdef DEBUG
        if (lights) {
          // @endif
          revealBuriedItems({
            sprites: activeSprites,
            predicted: predicted.entities,
            poses: remotePoses,
          });
          // @ifdef DEBUG
        }
        // @endif

        activeSprites.forEach(
          (item) =>
            item.item &&
            !item.buried &&
            !item.dead &&
            item.render({ pose: remotePoses.get(item.id) }),
        );
      }

      activeSprites.forEach((craft) => {
        if (!(craft instanceof Craft) || craft.dead) return;
        const prediction = predicted.entities.get(craft.id);
        const renderedCraft =
          prediction instanceof Craft &&
          prediction.constructor === craft.constructor
            ? prediction
            : craft;

        renderedCraft.render({
          scenery: activeSprites,
          zIndex,
          pose: remotePoses.get(craft.id),
        });
      });
    }

    activeSprites.forEach(
      (object) =>
        object instanceof Projectile &&
        !object.dead &&
        object.render({ pose: remotePoses.get(object.id) }),
    );

    renderEffects({ ctx, poses: remotePoses });
    // Sparks off the HornDrill sit over the asteroids and ships they come off
    renderSparks(ctx);

    ctx.restore();

    // @ifdef DEBUG
    renderDebug({
      game,
      sprites: activeSprites,
      ship: renderedShip,
    });

    renderDebugDemos(game);
    // @endif

    syncDockedUi({
      ship: renderedShip,
      available: Boolean(game.uiVisible && !network.shipDestroyed),
    });

    if (!ui.current) {
      renderUI(game, stationMarkers, {
        controlsShip: renderedShip,
        shipDestroyed: network.shipDestroyed,
        shipStranded: network.shipStranded,
      });
    }
  },
  update: ({ dt, now }) => {
    updateEffects(dt * 1000);

    if (player.ship.launchRequested) {
      playerInput.launch = true;
      player.ship.launchRequested = 0;
      network.recordInput({ input: playerInput });
    }

    if (network.updateFrame({ input: playerInput, dt, now })) {
      refreshReplication();
      syncPlayerShip();
      ui.current?.update();

      const events = network.takeEvents();

      if (
        events.some(
          (event) =>
            event.type === 'docked' && event.playerId === network.playerId,
        )
      ) {
        moduleControls.forEach(({ writeInput }) =>
          writeInput({ input: playerInput, active: false }),
        );
      }

      presentEvents({
        events,
        onMessage: readSlate,
        playerId: network.playerId,
        shipId: network.shipId,
      });
    }

    syncSimulationObjects(dt);

    // Things that happen at 15 Hz, or as soon as sprites
    // come or go, so shipwreck fragments are not left out: refresh the active tier.
    activeTime += dt;

    if (activeTime >= 1 / 15 || spriteCount !== game.sprites.length) {
      activeTime %= 1 / 15;
      spriteCount = game.sprites.length;
      activeSprites = game.sprites.filter(
        (sprite) =>
          !sprite.dead &&
          Vec.distance(sprite.position, player.ship.position) <= activeRadius,
      );
    }

    // Presentation follows the display rate, not the network tick rate.
    updateSparks(dt * 1000);
    updatePlayer(dt);
    player.ship.updateVisual(dt);
    updateHornDrillSounds({ crafts: game.crafts });

    if (game.uiVisible) game.uiAlpha = Math.min(1, game.uiAlpha + 2 * dt);

    activeSprites.forEach(
      (sprite) => !sprite.dead && !sprite.networked && sprite.update(dt),
    );
  },
});

const ready = Promise.all([
  network.ready,
  // The HTML preloads the font. Wait before the first HUD frame so canvas
  // doesn't briefly draw fallback glyphs; a failed asset mustn't stop play.
  document.fonts.load('16px Gemetric').catch(() => {}),
]).then(() => {
  refreshReplication();
  syncPlayerShip();
  player.started = true;

  if (network.shipDestroyed) {
    centerCamera(game, { position: network.spawnPosition });
    game.uiVisible = 1;
    game.uiAlpha = 1;
  } else {
    // Keep the camera transition clear before bringing the HUD into view.
    setTimeout(() => (game.uiVisible = 1), dockDuration * 1000);
  }

  gameStarted = true;
  gameLoop.start();
});

const identityPreview = (): Identity => {
  const { ship, credits } = player;

  return [
    `PILOT ${String(network.playerId).padStart(3, '0')}`,
    credits,
    [
      ship.definitionId || 'mustang',
      paintColors.findIndex((shades) => shades === ship.shades),
      ship.hullHealth,
      ship.moduleStates
        .filter((module) => module.mount >= 0)
        .map((module) => [
          module.type,
          module.mount,
          paintColors.findIndex((shades) => shades === module.shades),
          module.health ?? null,
        ]),
    ],
  ];
};

export default { ready, identityPreview };
