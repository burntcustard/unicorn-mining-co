import assert from 'node:assert/strict';

const saved = localStorage.getItem('unicorn-controls');
const loadBindings = (
  version: string,
): Promise<typeof import('../../src/client/input/keybindings')> =>
  import(
    new URL('../../src/client/input/keybindings.ts', import.meta.url).href +
      '?' +
      version
  );

try {
  localStorage.removeItem('unicorn-controls');
  const defaults = await loadBindings('defaults');

  assert.deepEqual(defaults.defaultKeybindings.targetNext.keys, ['t']);
  const legacy = defaults.bindingEntries
    .slice(0, -1)
    .map(([, binding]) => [...binding.keys]);

  legacy[0] = ['q'];
  localStorage.setItem('unicorn-controls', JSON.stringify(legacy));
  const migrated = await loadBindings('legacy');

  assert.deepEqual(
    migrated.bindingEntries.slice(0, -1).map(([, binding]) => binding.keys),
    legacy,
    'adding targeting preserves old saved bindings',
  );
  assert.deepEqual(migrated.defaultKeybindings.targetNext.keys, ['t']);
  migrated.defaultKeybindings.targetNext.keys = ['n'];
  migrated.saveBindings();
  const reloaded = await loadBindings('reloaded');

  assert.deepEqual(
    reloaded.defaultKeybindings.targetNext.keys,
    ['n'],
    'target binding survives reload',
  );
  assert.deepEqual(reloaded.defaultKeybindings.forwardThrust.keys, ['q']);
  reloaded.resetBindings();
  assert.deepEqual(
    reloaded.defaultKeybindings.targetNext.keys,
    ['t'],
    'reset restores the default target key',
  );
} finally {
  if (saved === null) {
    localStorage.removeItem('unicorn-controls');
  } else {
    localStorage.setItem('unicorn-controls', saved);
  }
}
