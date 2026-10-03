/* global window */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { PredictionManager } from '../../src/client/prediction/prediction.ts';
import {
  createWorld,
  addEntity,
  addPlayer,
} from '../../src/client/simulation/world.ts';
import { createShip } from '../../src/client/objects/create-ship.ts';
import { emptyPlayerInput } from '../../src/client/protocol/input.ts';

globalThis.window = new EventTarget();
globalThis.KeyboardEvent = class extends Event {
  constructor(type, { key, repeat = false }) {
    super(type, { cancelable: true });
    this.key = key;
    this.repeat = repeat;
  }
};

const bundle = await rolldown({
  input: 'input',
  plugins: [
    {
      name: 'input-test-entry',
      load: (id) => {
        if (id === '\0input') {
          return `export * from '${process.cwd()}/src/client/input/input.ts';export {GameLoop} from '${process.cwd()}/src/client/game-loop.ts';export {maxPredictionTicks} from '${process.cwd()}/src/definitions/prediction.ts';export {simulationStep} from '${process.cwd()}/src/definitions/simulation.ts';`;
        }

        if (id.endsWith('/src/client/core.ts')) {
          return 'export const context={clearRect(){}};';
        }

        if (id.endsWith('/src/client/audio/sound-loader.ts')) {
          return 'export const unlockAudio = () => {};';
        }
      },
      resolveId: (id) => (id === 'input' ? '\0input' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });
const input = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const changes = [];

const stopKeys = input.initKeys({ onChange: (state) => changes.push(state) });

window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' }));
assert.equal(input.playerInput.hornDrill, true);
window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
assert.equal(input.playerInput.hornDrill, true);
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
assert.equal(input.playerInput.hornDrill, false);

console.log('toggle input test passed');

const beforeTap = changes.length;

window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
assert.equal(changes.at(-1).turn, -1, 'press is captured synchronously');
window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
assert.equal(
  changes.at(-1).turn,
  0,
  'release is captured before any frame runs',
);
assert.equal(changes.length, beforeTap + 2);
assert.equal(
  changes.at(-2).turn,
  -1,
  'captured states are not mutable aliases',
);
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
window.dispatchEvent(new Event('blur'));
assert.equal(input.playerInput.thrust, 0);
assert.equal(input.playerInput.turn, 0, 'focus loss releases movement');
let escaped = false;

input.bindKeys('Escape', () => {
  escaped = true;
});
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
assert(escaped, 'full key names work for menu bindings');

stopKeys();
let respawnKeys = 0;
const stopDeadKeys = input.initKeys({
  onKeyDown: () => {
    respawnKeys++;
    return true;
  },
});

window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
assert.equal(respawnKeys, 1, 'any new key can request a respawn');
assert.equal(input.playerInput.thrust, 0, 'respawn key does not fly the ship');
stopDeadKeys();

const clock = globalThis.performance;
let now = 0;
let updates = 0;
let renders = 0;
let frameTime;
const frames = [];
const maxFrameTime = input.maxPredictionTicks * input.simulationStep;

globalThis.performance = { now: () => now };
globalThis.canvas = { width: 1, height: 1 };
globalThis.requestAnimationFrame = (frame) => frames.push(frame);

try {
  input
    .GameLoop({
      update(timing) {
        updates++;
        frameTime = timing;
        // Vary the time spent simulating without moving the frame's clock.
        now += updates % 2 ? 8 : 1;
      },
      render(timing) {
        const { dt } = timing;

        assert.equal(dt, frameTime.dt, 'rendering uses the frame interval');
        assert.equal(
          timing.now,
          frameTime.now,
          'prediction uses the same display time as simulation',
        );
        renders++;
        assert(
          dt > 0 && dt <= maxFrameTime,
          'frame catch-up is bounded by the prediction horizon',
        );
      },
    })
    .start();
  // Ordinary slow frames retain all elapsed time. Longer pauses are capped,
  // and the first normal frame afterward must not replay the discarded debt.
  const elapsedFrames = [
    750,
    1000 / 60,
    100,
    200,
    2000,
    1000 / 60,
    ...Array(12).fill(1000 / 120),
  ];

  elapsedFrames.forEach((elapsedMs, index) => {
    now = (frameTime?.now || 0) + elapsedMs;
    const frameStartedAt = now;

    frames.shift()(frameStartedAt);
    assert.equal(updates, index + 1, 'each frame invokes update once');
    assert.equal(renders, updates, 'each update is followed by rendering');
    assert.equal(frameTime.now, frameStartedAt);
    assert(
      Math.abs(frameTime.dt - Math.min(elapsedMs / 1000, maxFrameTime)) < 1e-12,
      `${elapsedMs}ms frame preserves elapsed time up to the catch-up limit`,
    );
    assert.equal(frames.length, 1, 'only the next animation frame is queued');
  });

  // Follow a real predicted ship through tick boundaries at several display
  // rates. CPU work and callback scheduling must not change its visible speed.
  for (const hz of [60, 120, 144]) {
    for (const speed of [272, 1200]) {
      frames.length = 0;
      now = 0;
      const world = createWorld();
      const ship = addEntity(world, createShip(world, { playerId: 1 }));

      ship.drag = 0;
      ship.engine.forwardThrust = speed / 17;
      ship.velocity.x = speed;
      addPlayer(world, { id: 1, shipId: ship.id });
      const prediction = new PredictionManager({ world });

      prediction.setLocalPlayer({ playerId: 1 });
      let pending = 0;
      let tickStartedAt = 0;
      let previous = 0;
      const distances = [];

      input
        .GameLoop({
          update({ dt, now: displayTime }) {
            pending += dt;

            while (pending + 1e-12 >= input.simulationStep) {
              pending = Math.max(0, pending - input.simulationStep);
              prediction.step({ input: emptyPlayerInput(), send() {} });
              tickStartedAt = displayTime - pending * 1000;
            }
            // Expensive tick frames alternate with cheap in-between frames.
            now += world.tick % 2 ? 8 : 1;
          },
          render({ now: displayTime }) {
            const predicted = prediction
              .predictFrame({
                elapsed: (displayTime - tickStartedAt) / 1000,
              })
              .entities.get(ship.id);

            distances.push(predicted.position.x - previous);
            previous = predicted.position.x;
          },
        })
        .start();

      for (let index = 1; index <= hz * 2; index++) {
        const displayTime = (index * 1000) / hz;

        now = displayTime + (index % 3 ? 0.2 : 2);
        frames.shift()(displayTime);
      }
      const spread = Math.max(...distances) - Math.min(...distances);

      console.log(
        `${hz} Hz, ${speed} units/s: frame-distance spread ${spread}`,
      );
      assert(
        spread < 1e-5,
        'steady flight stays smooth despite variable CPU time',
      );
      assert(
        Math.abs(previous - speed * 2) < 1e-5,
        'flight preserves elapsed distance',
      );
    }
  }
} finally {
  globalThis.performance = clock;
  delete globalThis.requestAnimationFrame;
  delete globalThis.canvas;
}
console.log('Frame catch-up is bounded after short and long stalls');
