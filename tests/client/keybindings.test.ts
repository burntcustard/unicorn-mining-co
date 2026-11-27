import assert from 'node:assert/strict';
import {
  bindingEntries,
  defaultKeybindings,
} from '../../src/client/input/keybindings';

const storageKey = 'unicorn-controls';
const legacy = bindingEntries
  .slice(0, -2)
  .map(([, binding]) => [binding.keys, Number(binding.mode === 'toggle')]);

legacy[0] = [['q'], 0];
localStorage.setItem(storageKey, JSON.stringify(legacy));

const restored: typeof import('../../src/client/input/keybindings') =
  await import(
    new URL('../../src/client/input/keybindings.ts?legacy', import.meta.url)
      .href
  );

assert.deepEqual(restored.defaultKeybindings.forwardThrust.keys, ['q']);
assert.deepEqual(
  restored.defaultKeybindings.flightMode,
  defaultKeybindings.flightMode,
);
assert.deepEqual(
  restored.defaultKeybindings.thrustBoost,
  defaultKeybindings.thrustBoost,
);
restored.saveBindings();
assert.deepEqual(
  JSON.parse(localStorage.getItem(storageKey)!).slice(0, -2),
  legacy,
  'new controls do not shift saved action indexes',
);
