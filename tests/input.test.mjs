/* global window */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

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
          return `export * from '${process.cwd()}/src/client/input.ts';export {GameLoop} from '${process.cwd()}/src/client/game-loop.ts';`;
        }

        if (id.endsWith('/src/client/core.ts')) {
          return 'export const context={clearRect(){}};';
        }

        if (id.endsWith('/src/client/sound-loader.ts')) {
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

input.initKeys({ onChange: (state) => changes.push(state) });
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' }));
assert.equal(input.playerInput.drill, true);
window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
assert.equal(input.playerInput.drill, true);
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
assert.equal(input.playerInput.drill, false);

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

const clock = globalThis.performance;
let now = 0;
let updates = 0;
let renders = 0;
let frameTime;
const frames = [];

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

        assert.equal(
          timing,
          frameTime,
          'prediction and rendering share the timestamp from before update work',
        );
        assert(timing.now < now, 'CPU work must not advance the rendered pose');
        renders++;
        assert(
          dt > 0 && dt <= 0.1,
          'camera frame time is bounded after stalls',
        );
      },
    })
    .start();
  now = 750;
  frames.shift()();
  assert.equal(updates, 1, 'a stall must not trigger catch-up updates');
  assert.equal(renders, 1, 'the stalled frame still renders');
  now += 1000 / 60;
  frames.shift()();
  assert.equal(updates, 2, 'old frame debt must not carry into the next frame');
  now += 2000;
  frames.shift()();
  assert.equal(updates, 3, 'a long background pause is bounded too');
  assert.equal(renders, 3);

  for (let frame = 0; frame < 12; frame++) {
    now += 1000 / 120;
    frames.shift()();
  }
  assert.equal(updates, 15, 'each high-refresh frame updates before rendering');
  assert.equal(renders, updates);
} finally {
  globalThis.performance = clock;
  delete globalThis.requestAnimationFrame;
  delete globalThis.canvas;
}
console.log('Frame catch-up is bounded after short and long stalls');
