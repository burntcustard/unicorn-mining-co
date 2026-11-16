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
    keys: ['h'],
    mode: 'hold',
  });

  assert.deepEqual(defaults.defaultKeybindings.targetNext.keys, ['t']);
  assert.deepEqual(defaults.defaultKeybindings.fpsCounter.keys, ['f']);
  assert.equal(defaults.defaultKeybindings.fpsCounter.mode, 'toggle');
  assert.deepEqual(defaults.defaultKeybindings.requestGateAccess.keys, ['r']);
  assert.equal(defaults.defaultKeybindings.requestGateAccess.mode, 'press');
  assert.deepEqual(defaults.defaultKeybindings.telemetry.keys, ['v']);
  assert.equal(defaults.defaultKeybindings.telemetry.mode, 'press');
  assert.equal(
    defaults.bindingEntries.filter(([, binding]) => binding.keys.includes('v'))
      .length,
    1,
    'telemetry uses an otherwise unused default key',
  );

  assert.deepEqual(defaults.defaultKeybindings.sectorMap, {
    keys: ['Tab'],
    mode: 'press',
  });

  assert.deepEqual(defaults.defaultKeybindings.flightMode, {
    keys: ['c'],
    mode: 'toggle',
  });

  assert.equal(
    defaults.bindingEntries.at(-1)![1],
    defaults.defaultKeybindings.flightMode,
    'the new binding is appended after every existing saved binding index',
  );
  assert.equal(
    defaults.bindingEntries.filter(([, binding]) => binding.keys.includes('c'))
      .length,
    1,
    'flight mode has a dedicated default key',
  );

  defaults.defaultKeybindings.forwardThrust.keys = ['q'];
  defaults.defaultKeybindings.targetNext.keys = ['n'];
  defaults.defaultKeybindings.requestGateAccess.keys = ['g'];
  defaults.defaultKeybindings.searchLight.mode = 'hold';
  defaults.defaultKeybindings.hornDrill.mode = 'toggle';
  defaults.defaultKeybindings.cargoRelease.keys = ['j'];
  defaults.defaultKeybindings.sectorMap.keys = ['m'];
  defaults.defaultKeybindings.flightMode.keys = ['x'];
  defaults.defaultKeybindings.flightMode.mode = 'hold';
  defaults.saveBindings();
  const reloaded = await loadBindings('reloaded');

  assert.deepEqual(reloaded.defaultKeybindings.forwardThrust.keys, ['q']);
  assert.deepEqual(reloaded.defaultKeybindings.targetNext.keys, ['n']);
  assert.deepEqual(reloaded.defaultKeybindings.requestGateAccess.keys, ['g']);
  assert.deepEqual(reloaded.defaultKeybindings.cargoRelease.keys, ['j']);
  assert.deepEqual(reloaded.defaultKeybindings.sectorMap.keys, ['m']);
  assert.equal(reloaded.defaultKeybindings.searchLight.mode, 'hold');
  assert.equal(reloaded.defaultKeybindings.hornDrill.mode, 'toggle');
  assert.equal(reloaded.defaultKeybindings.requestGateAccess.mode, 'press');

  assert.deepEqual(reloaded.defaultKeybindings.flightMode, {
    keys: ['x'],
    mode: 'hold',
  });

  assert.deepEqual(reloaded.bindingModes, ['hold', 'toggle']);

  const currentSaved = JSON.parse(localStorage.getItem('unicorn-controls')!);
  const legacySaved = currentSaved.slice(0, -1);
  const previousBindings = reloaded.bindingEntries
    .slice(0, -1)
    .map(([label, binding]) => [label, [...binding.keys], binding.mode]);

  localStorage.setItem('unicorn-controls', JSON.stringify(legacySaved));
  const legacy = await loadBindings('legacy-without-flight-mode');

  assert.deepEqual(
    legacy.bindingEntries
      .slice(0, -1)
      .map(([label, binding]) => [label, [...binding.keys], binding.mode]),
    previousBindings,
    'all old saved keys and modes retain their original action indexes',
  );

  assert.deepEqual(legacy.defaultKeybindings.flightMode, {
    keys: ['c'],
    mode: 'toggle',
  });

  legacy.saveBindings();
  const upgraded = JSON.parse(localStorage.getItem('unicorn-controls')!);

  assert.deepEqual(upgraded.slice(0, -1), legacySaved);
  assert.deepEqual(upgraded.at(-1), [['c'], 1]);
  assert.equal(upgraded.length, legacy.bindingEntries.length);

  localStorage.setItem(
    'unicorn-controls',
    JSON.stringify(legacySaved.slice(0, -1)),
  );
  const truncated = await loadBindings('truncated-before-legacy-length');

  assert.deepEqual(truncated.defaultKeybindings.forwardThrust.keys, [
    'ArrowUp',
  ]);
  localStorage.setItem('unicorn-controls', JSON.stringify(upgraded));

  const invalid = JSON.parse(localStorage.getItem('unicorn-controls')!);

  invalid[0][1] = 2;
  localStorage.setItem('unicorn-controls', JSON.stringify(invalid));
  const rejected = await loadBindings('invalid');

  assert.deepEqual(rejected.defaultKeybindings.forwardThrust.keys, ['ArrowUp']);
  reloaded.resetBindings();
  assert.deepEqual(reloaded.defaultKeybindings.forwardThrust.keys, ['ArrowUp']);
  assert.deepEqual(reloaded.defaultKeybindings.targetNext.keys, ['t']);
  assert.deepEqual(reloaded.defaultKeybindings.sectorMap.keys, ['Tab']);
  assert.equal(reloaded.defaultKeybindings.searchLight.mode, 'toggle');

  assert.deepEqual(reloaded.defaultKeybindings.flightMode, {
    keys: ['c'],
    mode: 'toggle',
  });
} finally {
  if (saved === null) {
    localStorage.removeItem('unicorn-controls');
  } else {
    localStorage.setItem('unicorn-controls', saved);
  }
}
