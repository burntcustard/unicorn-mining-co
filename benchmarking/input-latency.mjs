/* global Buffer, process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

globalThis.window = new EventTarget();
globalThis.KeyboardEvent = class extends Event {
  constructor(type, key) {
    super(type, { cancelable: true });
    this.key = key;
    this.repeat = false;
  }
};

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
            export { initKeys } from '${process.cwd()}/src/client/input.ts';
            export { PredictionManager } from '${process.cwd()}/src/client/prediction.ts';
            export { addEntity, addPlayer, createWorld } from '${process.cwd()}/src/shared/simulation/world.ts';
            export { createShip } from '${process.cwd()}/src/shared/craft/create-ship.ts';
          `;
        }

        if (id.endsWith('/src/client/core.ts')) {
          return 'export const context={clearRect(){}};';
        }

        if (id.endsWith('/src/client/sound-loader.ts')) {
          return 'export const unlockAudio=()=>{};';
        }
      },
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const game = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const clock = globalThis.performance;
let now = 0;
const frames = [];

globalThis.performance = { now: () => now };
globalThis.canvas = { width: 1, height: 1 };
globalThis.requestAnimationFrame = (frame) => frames.push(frame);

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
  let result;
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
  window.dispatchEvent(new KeyboardEvent('keydown', 'ArrowLeft'));
  now = 1000 / 60;
  frames.shift()();
  assert(result.firstFrameRotation < 0, 'ArrowLeft steers on the next frame');
  assert(
    result.keyToRenderMs < result.displayFrameMs,
    'response stays within one display frame',
  );
  console.log(JSON.stringify(result));
  stopKeys();
} finally {
  globalThis.performance = clock;
  delete globalThis.canvas;
  delete globalThis.requestAnimationFrame;
}
