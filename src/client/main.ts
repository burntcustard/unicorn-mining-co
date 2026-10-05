import { renderingLayers } from '../definitions/rendering-layers';
import { init } from './core';
import { dockDuration } from '../definitions/camera';
import * as Vec from './utilities/vector';
import { Craft } from './objects/craft';
import { Station } from './objects/station';
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
} from './debug/debug';

// @endif
import { bindAction, initKeys, playerInput } from './input/input';
import { defaultKeybindings, moduleBinding } from './input/keybindings';
import { network } from './network/network';
import { camera, centerCamera, followTarget } from './camera';

import { revealBuriedItems } from './utilities/lighting';
import { message as messageDefinition } from '../definitions/items';
import {
  adoptPlayerShip,
  playerShip,
  readSlate,
  updatePlayer,
  syncPaintUnlocks,
} from './player';
import { renderSparks, updateSparks } from './effects/shrapnel';
import { presentEvents } from './effects/present-events';
import { GameLoop } from './game-loop';
import { Ship } from './objects/ship';
import { ShieldGenerator, SearchLight } from './objects/modules/index';
import { moduleControls } from './objects/control-ship';

// @ifdef BENCHMARK
import { benchmarkFlag } from './debug/benchmark';

// @endif
import { colors } from '../definitions/colors';
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

  if (playerShip !== ship) {
    refreshReplication();
    adoptPlayerShip({ ship });
  }
};

const syncSimulationObjects = (dt: number) => {
  regionalObjects.forEach((object) => {
    if (object instanceof Craft && object !== playerShip) {
      object.updateVisual(dt);
    }
  });
};

// @ifdef DEBUG
const debugWreck = new Ship({
  shades: colors.orange,
  position: Vec.add(playerShip.position, Vec.create(500)),
}).addToScene();

const debugNote = new Item(messageDefinition).addToScene();

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
    position: Vec.create(),
  });
}
// @endif

// @ifdef DEBUG
// Lets the console (and automated checks) watch the clock the client is
// predicting on against the last tick the server reported.
Object.assign(window, { game, network, playerShip });
// @endif

const activeRadius = 2000;
let activeSprites: SimulationObject[] = [];
let activeTime = 0;
let spriteCount = 0;

initKeys({
  onChange: (input) => network.recordInput({ input }),
  onKeyDown: () => {
    if (!network.shipDestroyed) return false;
    network.requestRespawn();
    return true;
  },
});

moduleControls.forEach(({ Type, input: action }) =>
  bindAction(moduleBinding(action), () => {
    if (playerShip.launching || playerShip.dockedTo) return;
    const segment = playerShip.segments.find(
      (segment) =>
        segment.module.constructor === Type && segment.mount.health > 0,
    );

    if (!segment || playerShip.dead) return;

    if (Type === ShieldGenerator) playSound(segment.active ? 6 : 7);

    if (Type === SearchLight) playSound(9);
  }),
);

bindAction(
  defaultKeybindings.menuLeft,
  () => playerShip.dockedTo && moveSubSelection(-1, playerShip),
);
bindAction(
  defaultKeybindings.menuBack,
  () => playerShip.dockedTo && back(playerShip),
);
bindAction(
  defaultKeybindings.menuSelect,
  () => playerShip.dockedTo && confirmSelection(playerShip),
);
bindAction(
  defaultKeybindings.menuRight,
  () => playerShip.dockedTo && moveSubSelection(1, playerShip),
);
bindAction(
  defaultKeybindings.menuUp,
  () => playerShip.dockedTo && moveSelection(-1, playerShip),
);
bindAction(
  defaultKeybindings.menuDown,
  () => playerShip.dockedTo && moveSelection(1, playerShip),
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

    const predictedPlayerShip = predicted.entities.get(playerShip.id);
    const renderedShip =
      predictedPlayerShip instanceof Ship ? predictedPlayerShip : playerShip;
    const playerPose = remotePoses.get(playerShip.id) || renderedShip;

    if (!network.shipDestroyed) {
      followTarget(
        game,
        { position: playerPose.position, dockedTo: playerShip.dockedTo },
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

    renderUI(game, stationMarkers, {
      controlsShip: renderedShip,
      shipDestroyed: network.shipDestroyed,
    });
  },
  update: ({ dt, now }) => {
    syncPaintUnlocks(network.unlockedPaints);

    if (playerShip.launchRequested) {
      playerInput.launch = true;
      playerShip.launchRequested = 0;
    }

    if (network.updateFrame({ input: playerInput, dt, now })) {
      refreshReplication();
      syncPlayerShip();

      presentEvents({
        events: network.takeEvents(),
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
          Vec.distance(sprite.position, playerShip.position) <= activeRadius,
      );
    }

    // Presentation follows the display rate, not the network tick rate.
    updateSparks(dt);
    updatePlayer(dt);
    playerShip.updateVisual(dt);
    updateHornDrillSounds({ crafts: game.crafts });

    if (game.uiVisible) game.uiAlpha = Math.min(1, game.uiAlpha + 2 * dt);

    activeSprites.forEach(
      (sprite) => !sprite.dead && !sprite.networked && sprite.update(dt),
    );
  },
});

// Let the inline sky settle before the game reveals its real starting place.
setTimeout(() => {
  void network.ready.then(() => {
    refreshReplication();
    syncPlayerShip();
    playerShip.started = 1;

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
});
