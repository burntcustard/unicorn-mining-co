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
          return `export * from '${process.cwd()}/src/client/input.ts';`;
        if (id.endsWith('/src/sound-loader.ts'))
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
