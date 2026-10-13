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

const preferences = await import('../../src/client/ui/dom/graphics.ts');
const { graphics, restoreGraphics, saveGraphics } = preferences;

assert.equal(preferences.rendererPreference, 'canvas');
assert.equal(preferences.useWebGL, false);
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

const activeRenderer = preferences.useWebGL;

preferences.saveRenderer('webgl');
assert.equal(storage.get('unicorn-renderer'), 'webgl');
assert.equal(preferences.rendererPreference, 'webgl');
assert.equal(
  preferences.useWebGL,
  activeRenderer,
  'changing the preference preserves the current canvas until reloading',
);
preferences.saveRenderer('canvas');
assert.equal(storage.get('unicorn-renderer'), 'canvas');

for (const browser of ['Chrome', 'Firefox']) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: browser },
    configurable: true,
  });

  for (const saved of [undefined, 'auto', 'canvas', 'webgl']) {
    if (saved) {
      storage.set('unicorn-renderer', saved);
    } else {
      storage.delete('unicorn-renderer');
    }

    const restored = await import(
      '../../src/client/ui/dom/graphics.ts' +
        '?renderer=' +
        browser +
        '-' +
        (saved ?? 'default')
    );

    assert.equal(
      restored.rendererPreference,
      saved === 'webgl' ? 'webgl' : 'canvas',
      `${browser} uses Canvas unless WebGL is explicitly selected`,
    );
    assert.equal(restored.useWebGL, saved === 'webgl');
  }
}
