import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

assert.equal(localStorage.length, 0, 'each test process starts empty');
assert.equal(localStorage.getItem('missing'), null);
assert.equal(localStorage.key(0), null);

localStorage.setItem('unicorn-controls', '["q"]');
localStorage.setItem('unicorn-graphics', '[true,false,true,1]');
assert.equal(localStorage.length, 2);
assert.equal(localStorage.getItem('unicorn-controls'), '["q"]');
assert.equal(localStorage.key(0), 'unicorn-controls');
assert.equal(localStorage.key(1), 'unicorn-graphics');
assert.equal(localStorage.key(2), null);

localStorage.setItem('unicorn-controls', '["w"]');
assert.equal(localStorage.length, 2, 'overwriting does not add a key');
assert.equal(localStorage.getItem('unicorn-controls'), '["w"]');

Reflect.apply(Reflect.get(localStorage, 'setItem'), localStorage, [123, false]);
assert.equal(localStorage.getItem('123'), 'false');
assert.equal(
  Reflect.apply(Reflect.get(localStorage, 'getItem'), localStorage, [123]),
  'false',
);
Reflect.apply(Reflect.get(localStorage, 'removeItem'), localStorage, [123]);
assert.equal(localStorage.getItem('123'), null);

localStorage.removeItem('unicorn-controls');
assert.equal(localStorage.length, 1);
assert.equal(localStorage.key(0), 'unicorn-graphics');
localStorage.removeItem('missing');
assert.equal(localStorage.length, 1);

localStorage.clear();
assert.equal(localStorage.length, 0);
assert.equal(localStorage.getItem('unicorn-graphics'), null);

localStorage.setItem('parent', 'saved');
execFileSync(process.execPath, [
  '--import',
  'tsx',
  '--import',
  new URL('../support/local-storage.ts', import.meta.url).href,
  '--input-type=module',
  '--eval',
  `import assert from 'node:assert/strict';
   assert.equal(localStorage.length, 0, 'another process starts empty');
   localStorage.setItem('child', 'saved');`,
]);
assert.equal(localStorage.getItem('parent'), 'saved');
assert.equal(
  localStorage.getItem('child'),
  null,
  'processes do not share data',
);
localStorage.clear();
