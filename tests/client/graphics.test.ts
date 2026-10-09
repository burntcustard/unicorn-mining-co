import assert from 'node:assert/strict';

const storage = new Map<string, string>();
const events = new EventTarget();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: events,
  configurable: true,
});

const { graphics, restoreGraphics, saveGraphics } =
  await import('../../src/client/ui/dom/graphics.ts');

assert.deepEqual(graphics, [true, true, true, 1]);
storage.set(
  'unicorn-graphics',
  JSON.stringify([false, true, false, false, 0.5]),
);
restoreGraphics();
assert.deepEqual(
  graphics,
  [false, true, false, 0.5],
  'old preferences preserve resolution and discard the glow toggle',
);

let changes = 0;

events.addEventListener('ui-graphics', () => changes++);
saveGraphics();
assert.deepEqual(
  JSON.parse(storage.get('unicorn-graphics')!),
  [false, true, false, 0.5],
  'saving uses the four remaining preferences',
);
assert.equal(changes, 1);

storage.set('unicorn-graphics', JSON.stringify([true, false, true, 1.5]));
restoreGraphics();
assert.deepEqual(
  graphics,
  [true, false, true, 1.5],
  'new preferences restore resolution from its new position',
);

storage.set('unicorn-graphics', JSON.stringify([true, false, true, false]));
restoreGraphics();
assert.equal(
  graphics[3],
  1.5,
  'a boolean cannot become the rendering resolution',
);
