/* global window */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

globalThis.window = {};
globalThis.KeyboardEvent = class {
  constructor(type, { key }) {
    this.key = key;
    this.repeat = false;
    this.type = type;
  }
};

const bundle = await rolldown({
  input: 'input',
  plugins: [
    {
      name: 'input-test-entry',
      load: (id) => {
        if (id === '\0input')
          return `export * from '${process.cwd()}/src/client/input.ts';export {GameLoop} from '${process.cwd()}/src/client/game-loop.ts';`;
        if (id.endsWith('/src/client/core.ts'))
          return 'export const context={clearRect(){}};';
        if (id.endsWith('/src/client/sound-loader.ts'))
          return 'export const unlockAudio = () => {};';
      },
      resolveId: (id) => (id === 'input' ? '\0input' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });
const input = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

input.initKeys();
window.onkeydown(new KeyboardEvent('keydown', { key: 'd' }));
assert.equal(input.playerInput.drill, true);
window.onkeyup(new KeyboardEvent('keyup', { key: 'd' }));
assert.equal(input.playerInput.drill, true);
window.onkeydown(new KeyboardEvent('keydown', { key: 'd' }));
assert.equal(input.playerInput.drill, false);

console.log('toggle input test passed');

const clock = globalThis.performance;
let now = 0;
let updates = 0;
let renders = 0;
const frames = [];
globalThis.performance = { now: () => now };
globalThis.canvas = { width: 1, height: 1 };
globalThis.requestAnimationFrame = (frame) => frames.push(frame);
try {
  input
    .GameLoop({
      update() {
        updates++;
      },
      render() {
        renders++;
      },
    })
    .start();
  now = 750;
  frames.shift()();
  assert(updates <= 4, 'a stall must not trigger dozens of catch-up updates');
  assert.equal(renders, 1, 'the stalled frame still renders');
  now += 1000 / 60;
  frames.shift()();
  assert(updates <= 5, 'old frame debt must not carry into the next frame');
  now += 2000;
  frames.shift()();
  assert(updates <= 9, 'a long background pause is bounded too');
  assert.equal(renders, 3);
} finally {
  globalThis.performance = clock;
  delete globalThis.requestAnimationFrame;
  delete globalThis.canvas;
}
console.log('Frame catch-up is bounded after short and long stalls');
