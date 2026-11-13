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

  defaults.defaultKeybindings.forwardThrust.keys = ['q'];
  defaults.defaultKeybindings.targetNext.keys = ['n'];
  defaults.defaultKeybindings.requestGateAccess.keys = ['g'];
  defaults.defaultKeybindings.searchLight.mode = 'hold';
  defaults.defaultKeybindings.hornDrill.mode = 'toggle';
  defaults.defaultKeybindings.cargoRelease.keys = ['j'];
  defaults.defaultKeybindings.sectorMap.keys = ['m'];
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
  assert.deepEqual(reloaded.bindingModes, ['hold', 'toggle']);

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
} finally {
  if (saved === null) {
    localStorage.removeItem('unicorn-controls');
  } else {
    localStorage.setItem('unicorn-controls', saved);
  }
}
