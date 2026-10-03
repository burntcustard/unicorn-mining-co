/* global Buffer, process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

Object.assign(globalThis, { window: new EventTarget() });

class TestKeyboardEvent extends Event {
  key: string;
  repeat: boolean;
  constructor(type: string, key: string) {
    super(type, { cancelable: true });
    this.key = key;
    this.repeat = false;
  }
}

Object.assign(globalThis, { KeyboardEvent: TestKeyboardEvent });

const bundle = await rolldown({
  input: 'input-latency',
  plugins: [
    {
      name: 'input-latency',
      resolveId: (id) =>
        id === 'input-latency' ? '\0input-latency' : undefined,
      load: (id) => {
        if (id === '\0input-latency') {
          return `
            export { GameLoop } from '${process.cwd()}/src/client/game-loop.ts';
            export { initKeys } from '${process.cwd()}/src/client/input/input.ts';
            export { PredictionManager } from '${process.cwd()}/src/client/prediction/prediction.ts';
            export { addEntity, addPlayer, createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
            export { createShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
          `;
        }

        if (id.endsWith('/src/client/core.ts')) {
          return 'export const context={clearRect(){}};';
        }

        if (id.endsWith('/src/client/audio/sound-loader.ts')) {
          return 'export const unlockAudio=()=>{}; export const playSound=()=>{};';
        }
      },
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();

const game: {
  GameLoop: typeof import('../../src/client/game-loop').GameLoop;
  initKeys: typeof import('../../src/client/input/input').initKeys;
  PredictionManager: typeof import('../../src/client/prediction/prediction').PredictionManager;
  addEntity: typeof import('../../src/client/simulation/world').addEntity;
  addPlayer: typeof import('../../src/client/simulation/world').addPlayer;
  createWorld: typeof import('../../src/client/simulation/world').createWorld;
  createShip: typeof import('../../src/client/objects/create-ship').createShip;
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const clock = globalThis.performance;
let now = 0;
const frames: FrameRequestCallback[] = [];

Object.assign(globalThis, { performance: { now: () => now } });
Object.assign(globalThis, { canvas: { width: 1, height: 1 } });

Object.assign(globalThis, {
  requestAnimationFrame: (frame: FrameRequestCallback) => frames.push(frame),
});

try {
  const world = game.createWorld();
  const ship = game.addEntity(world, game.createShip(world, { playerId: 1 }));

  game.addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new game.PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });

  const stopKeys = game.initKeys({
    onChange: (input) =>
      prediction.recordInput({
        input,
        offset: now / 1000,
        send: () => {},
      }),
  });

  let result: Record<string, number>;

  const loop = game.GameLoop({
    update() {
      now += 8;
    },
    render({ now: poseTime }) {
      const pose = prediction.predictFrame({ elapsed: poseTime / 1000 });
      const drawn = pose.entities.get(ship.id);

      result = {
        displayFrameMs: 1000 / 60,
        updateWorkMs: 8,
        keyToRenderMs: now - 16.5,
        poseAgeAtRenderMs: now - poseTime,
        simulatedAfterKeyMs: poseTime - 16.5,
        firstFrameRotation: drawn.rotation,
        firstFrameSpin: drawn.spin,
      };
    },
  });

  loop.start();
  now = 16.5;
  window.dispatchEvent(new TestKeyboardEvent('keydown', 'ArrowLeft'));
  now = 1000 / 60;
  frames.shift()(now);
  assert(result.firstFrameRotation < 0, 'ArrowLeft steers on the next frame');
  assert(
    result.keyToRenderMs < result.displayFrameMs,
    'response stays within one display frame',
  );
  console.log(JSON.stringify(result));
  stopKeys();
} finally {
  globalThis.performance = clock;
  Reflect.deleteProperty(globalThis, 'canvas');
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
}
