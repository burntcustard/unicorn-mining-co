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

  assert.deepEqual(defaults.defaultKeybindings.cargoRelease, {
    keys: ['c'],
    mode: 'hold',
  });

  assert.deepEqual(defaults.defaultKeybindings.targetNext.keys, ['t']);
  assert.deepEqual(defaults.defaultKeybindings.fpsCounter.keys, ['f']);
  assert.equal(defaults.defaultKeybindings.fpsCounter.mode, 'toggle');
  assert.deepEqual(defaults.defaultKeybindings.requestGateAccess.keys, ['r']);
  assert.equal(defaults.defaultKeybindings.requestGateAccess.mode, 'press');
  const legacy = defaults.bindingEntries
    .slice(0, -3)
    .map(([, binding]) => [...binding.keys]);

  legacy[0] = ['q'];
  localStorage.setItem('unicorn-controls', JSON.stringify(legacy));
  const migrated = await loadBindings('legacy');

  assert.deepEqual(
    migrated.bindingEntries.slice(0, -3).map(([, binding]) => binding.keys),
    legacy,
    'adding targeting preserves old saved bindings',
  );
  assert.deepEqual(migrated.defaultKeybindings.targetNext.keys, ['t']);
  assert.deepEqual(migrated.defaultKeybindings.fpsCounter.keys, ['f']);
  migrated.defaultKeybindings.targetNext.keys = ['n'];
  localStorage.setItem(
    'unicorn-controls',
    JSON.stringify(
      migrated.bindingEntries.slice(0, -2).map(([, binding]) => binding.keys),
    ),
  );
  const withTargeting = await loadBindings('with-targeting');

  assert.deepEqual(withTargeting.defaultKeybindings.targetNext.keys, ['n']);
  assert.deepEqual(
    withTargeting.defaultKeybindings.fpsCounter.keys,
    ['f'],
    'adding the FPS shortcut preserves saved targeting and flight bindings',
  );
  withTargeting.defaultKeybindings.fpsCounter.keys = ['v'];
  withTargeting.saveBindings();
  localStorage.setItem(
    'unicorn-controls',
    JSON.stringify(
      withTargeting.bindingEntries
        .slice(0, -1)
        .map(([, binding]) => binding.keys),
    ),
  );
  const reloaded = await loadBindings('reloaded');

  assert.deepEqual(
    reloaded.defaultKeybindings.fpsCounter.keys,
    ['v'],
    'FPS binding survives reload',
  );
  assert.deepEqual(
    reloaded.defaultKeybindings.targetNext.keys,
    ['n'],
    'target binding survives reload',
  );
  assert.deepEqual(reloaded.defaultKeybindings.forwardThrust.keys, ['q']);
  assert.deepEqual(reloaded.defaultKeybindings.requestGateAccess.keys, ['r']);
  reloaded.defaultKeybindings.requestGateAccess.keys = ['g'];
  reloaded.saveBindings();
  const withAccess = await loadBindings('with-access');

  assert.deepEqual(withAccess.defaultKeybindings.requestGateAccess.keys, ['g']);
  assert.deepEqual(withAccess.defaultKeybindings.fpsCounter.keys, ['v']);
  withAccess.resetBindings();
  assert.deepEqual(withAccess.defaultKeybindings.requestGateAccess.keys, ['r']);
  reloaded.resetBindings();
  assert.deepEqual(
    reloaded.defaultKeybindings.fpsCounter.keys,
    ['f'],
    'reset restores the default FPS key',
  );
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
