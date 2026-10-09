import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../plugins/build-plugins.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';

// Run after a production build, with the standard game server and preview running.
const rootDirectory = process.cwd();
const fixtureDirectory = resolve('dist/ui-fixture');
const entryId = resolve('src/__dom_fixture.ts');
const fixtureCode = (
  await readFile('tests/fixtures/dom-ui.ts', 'utf8')
).replaceAll('../../src/', `${rootDirectory}/src/`);

const bundle = await rolldown({
  input: entryId,
  plugins: [
    {
      name: 'dom-fixture',
      resolveId(id) {
        if (id === entryId) return entryId;
      },
      async load(id) {
        if (id === entryId) return fixtureCode;

        if (id.endsWith('?raw')) {
          return `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))};`;
        }

        if (id.endsWith('.css')) return { code: '', moduleType: 'js' };
      },
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

await mkdir(fixtureDirectory, { recursive: true });

await bundle.write({
  dir: fixtureDirectory,
  format: 'esm',
  minify: true,
  entryFileNames: 'fixture.js',
  chunkFileNames: '[name]-[hash].js',
});

await bundle.close();
const stylesheet = (await readdir('dist')).find((name) =>
  name.endsWith('.css'),
);

await writeFile(
  `${fixtureDirectory}/index.html`,
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../${stylesheet}"></head><body><canvas id="canvas"></canvas><script type="module" src="fixture.js"></script></body></html>`,
);
const profile = await mkdtemp('/tmp/unicorn-ui-browser-');
const chrome = spawn(
  process.env.CHROME_BIN || 'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let logs = '';

chrome.on('error', (error) => {
  logs += error.message;
});

chrome.stderr.on('data', (chunk) => (logs += chunk));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];

const connect = async (url) => {
  const ws = new WebSocket(url);

  sockets.push(ws);
  await once(ws, 'open');
  let seq = 0;
  const pending = new Map();
  const events = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.id) {
      const p = pending.get(msg.id);

      pending.delete(msg.id);
      msg.error
        ? p.reject(new Error(JSON.stringify(msg.error)))
        : p.resolve(msg.result);
    } else events.push(msg);
  });

  return {
    events,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;

        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
  };
};

const evaluate = async (c, expression) => {
  const result = await c.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  assert(
    !result.exceptionDetails,
    result.exceptionDetails?.exception?.description,
  );
  return result.result.value;
};

try {
  let endpoint;

  for (let n = 0; n < 100; n++) {
    endpoint = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];

    if (endpoint) break;
    await pause(100);
  }

  assert(endpoint, logs);
  const root = await connect(endpoint);

  const { targetId } = await root.send('Target.createTarget', {
    url: 'about:blank',
  });

  const host = new URL(endpoint).host;
  const targets = await fetch(`http://${host}/json/list`).then((r) => r.json());
  const c = await connect(
    targets.find((t) => t.id === targetId).webSocketDebuggerUrl,
  );

  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Network.enable');
  await c.send('Page.enable');

  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await c.send('Page.navigate', { url: 'http://localhost:3000' });
  await pause(700);
  const check = (expression) => evaluate(c, expression);

  const checkHiddenElements = async () => {
    assert(
      await check(
        `[...document.querySelectorAll('[hidden]')].every(element => !element.getClientRects().length)`,
      ),
      'hidden elements have no layout boxes',
    );
  };

  const pressKey = async (key) => {
    for (const type of ['keyDown', 'keyUp']) {
      await c.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key,
        text: key === 'Enter' && type === 'keyDown' ? '\r' : undefined,
        windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9 }[key],
      });
    }
  };

  const click = async (selector) => {
    const [x, y] = await check(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center' });
      const box = element.getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);

    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });

    await c.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });

    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  };

  const checkShipPreview = async () => {
    const bounds = await check(`(() => {
      const canvas = document.querySelector('.ui-preview');
      const box = canvas.getBoundingClientRect();
      const { width, height } = canvas;
      const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let left = width, right = 0, top = height, bottom = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!pixels[(y * width + x) * 4 + 3]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return [right - left, bottom - top, box.left, left, top, width - right, height - bottom];
    })()`);

    assert(bounds[0] > 300 && bounds[1] > 300, 'ship renders at a large size');
    assert(bounds[2] >= 640, 'ship occupies the right side of the menu');
    assert(
      bounds.slice(3).every((margin) => margin > 0),
      'ship is not clipped',
    );
  };

  const capture = async (name) => {
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });

    await writeFile(`${profile}/${name}.png`, Buffer.from(data, 'base64'));
  };

  const errors = () =>
    c.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map(
        (e) =>
          e.params.exceptionDetails.exception?.description ||
          e.params.exceptionDetails.text,
      );

  assert(await check(`!!document.querySelector('#ui-root')`));
  await checkHiddenElements();
  await capture('menu');
  assert.deepEqual(
    await check(
      `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.textContent.trim())`,
    ),
    ['PLAY', 'SAVES', 'SETTINGS', 'CREDITS'],
    'the starting menu offers Saves without Disconnect',
  );
  assert(
    await check(
      `!document.querySelector('[data-resume-hint]').getClientRects().length`,
    ),
    'Escape hint stays hidden before starting the game',
  );
  assert(
    await check(`document.activeElement === document.body`),
    'opening the menu does not assign focus',
  );
  await pressKey('ArrowDown');
  await pause(180);
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-action="play"]')`,
    ),
    'Down starts navigation from an unfocused menu',
  );
  assert(
    await check(
      `getComputedStyle(document.activeElement).outlineStyle === 'none' && getComputedStyle(document.activeElement, '::before').opacity === '1' && getComputedStyle(document.activeElement.firstElementChild).transform === 'matrix(1, 0, 0, 1, 8, 0)'`,
    ),
    'arrow focus uses the main-menu hover appearance without the extra outline',
  );
  await pressKey('ArrowDown');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-action="saves"]')`,
    ),
    'Down focuses the next menu item',
  );
  await pressKey('ArrowUp');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-action="play"]')`,
    ),
    'Up focuses the previous menu item',
  );
  await pressKey('ArrowUp');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-action="credits"]')`,
    ),
    'Up wraps to the last menu item',
  );
  await pressKey('ArrowDown');
  await pressKey('Tab');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-action="saves"]') && getComputedStyle(document.activeElement).outlineStyle === 'solid'`,
    ),
    'Tab restores the normal keyboard-focus outline',
  );
  const playBox = await check(`(() => {
    const box = document.querySelector('[data-action="play"] span').getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2];
  })()`);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: playBox[0],
    y: playBox[1],
  });

  await pause(180);
  assert(
    await check(
      `document.activeElement === document.body && getComputedStyle(document.querySelector('[data-action="saves"]'), '::before').opacity === '0'`,
    ),
    'hovering main-menu text clears focus and the previous highlight',
  );
  assert(
    !(await check(
      `performance.getEntriesByType('resource').some(x=>/gameplay-/.test(x.name))`,
    )),
    'the starting ship preview does not fetch gameplay',
  );
  await checkShipPreview();
  assert(
    await check(
      `document.querySelector('.ui-pilot').hidden && !localStorage.getItem('playerToken') && !localStorage.getItem('unicorn-preview')`,
    ),
    'the starting ship preview does not create a pilot or cached identity',
  );
  assert(
    !c.events.some(
      (event) =>
        event.method === 'Network.webSocketCreated' ||
        (event.method === 'Network.requestWillBeSent' &&
          event.params.request.url.includes('/api/')),
    ),
    'the starting ship preview does not contact the game server',
  );
  await click('[data-action="settings"]');
  await checkHiddenElements();
  await pressKey('ArrowDown');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-controls]')`,
    ),
    'arrow navigation starts in the submenu navigation group',
  );
  const graphicsBox = await check(`(() => {
    const box = document.querySelector('[data-graphics]').getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2];
  })()`);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: graphicsBox[0],
    y: graphicsBox[1],
  });

  assert(
    await check(`document.activeElement === document.body`),
    'hovering a submenu item blurs the previously focused item',
  );

  const readOutline = () =>
    check(`(() => {
    const style = getComputedStyle(document.querySelector('[data-graphics]'));
    return [style.outlineStyle, style.outlineWidth, style.outlineColor];
  })()`);
  const hoverOutline = await readOutline();

  assert.equal(hoverOutline[0], 'solid');
  assert.notEqual(hoverOutline[1], '0px');
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await pressKey('ArrowRight');
  await pressKey('ArrowRight');
  assert(
    await check(
      `document.activeElement === document.querySelector('[data-graphics]') && document.activeElement.matches(':focus-visible')`,
    ),
    'arrow navigation shows keyboard focus',
  );
  assert.deepEqual(
    await readOutline(),
    hoverOutline,
    'hover and keyboard focus share an outline',
  );
  assert(
    await check(
      `document.querySelector('[data-controls]').getAttribute('aria-pressed') === 'true'`,
    ),
    'moving focus does not change selection',
  );
  await pressKey('Enter');
  assert(
    await check(
      `document.querySelector('[data-graphics]').getAttribute('aria-pressed') === 'true'`,
    ),
    'Enter selects the focused section',
  );
  await checkHiddenElements();
  assert.equal(
    await check(
      `document.querySelectorAll('[data-graphics-panel] [data-graphic]').length`,
    ),
    3,
    'graphics offers only starfield, clouds and sparkles toggles',
  );
  assert(
    await check(`(() => {
    const selected = getComputedStyle(document.querySelector('[data-graphics]'));
    const other = getComputedStyle(document.querySelector('[data-controls]'));
    return selected.backgroundColor !== other.backgroundColor && selected.color !== other.color && selected.webkitTextStrokeWidth === '0px';
  })()`),
    'selected buttons have a filled background and distinct text without the light-text stroke',
  );
  await click('[data-graphic="1"]');
  assert(
    await check(
      `JSON.parse(localStorage.getItem('unicorn-graphics'))[1] === false`,
    ),
  );
  assert.equal(
    await check(`JSON.parse(localStorage.getItem('unicorn-graphics')).length`),
    4,
    'graphics saves no glow preference',
  );
  await check(
    `document.querySelector('[data-resolution]').value = '0.5'; document.querySelector('[data-resolution]').dispatchEvent(new Event('change', {bubbles:true}));`,
  );
  assert(
    await check(`document.querySelector('#canvas').width === 640`),
    'resolution applies immediately',
  );
  await check(
    `document.querySelector('[data-resolution]').value = '1'; document.querySelector('[data-resolution]').dispatchEvent(new Event('change', {bubbles:true}));`,
  );
  await click('[data-controls]');
  await click('[data-bindings] button');
  assert(
    await check(`document.querySelector('[data-binding-dialog]').open`),
    'rebinding opens a modal dialog',
  );
  assert(
    await check(
      `document.querySelector('#binding-prompt').textContent === 'Press a new key for Forward thrust.'`,
    ),
    'dialog names the control being rebound',
  );
  await pressKey('ArrowLeft');
  assert(
    await check(
      `document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-binding-dialog] .ui-status').textContent.includes('Turn left')`,
    ),
    'conflicting keys keep the dialog open with feedback',
  );
  await pressKey('Shift');
  assert(
    await check(
      `document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-binding-dialog] .ui-status').textContent.includes('reserved')`,
    ),
    'reserved keys keep the dialog open',
  );

  await c.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'q',
    code: 'KeyQ',
  });

  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'q',
    code: 'KeyQ',
  });

  assert(
    await check(
      `document.querySelector('[data-bindings] button').textContent === 'Q'`,
    ),
  );
  assert(
    await check(
      `!document.querySelector('[data-binding-dialog]').open && JSON.parse(localStorage.getItem('unicorn-controls'))[0][0] === 'q'`,
    ),
    'a valid key is persisted and closes the dialog',
  );
  await click('[data-bindings] button');
  await pressKey('Escape');
  assert(
    await check(
      `!document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-bindings] button').textContent === 'Q' && !document.querySelector('[data-controls]').closest('.ui-screen').hidden`,
    ),
    'Escape cancels only the dialog without changing the binding or leaving settings',
  );
  await pressKey('Enter');
  assert(
    await check(`document.querySelector('[data-binding-dialog]').open`),
    'native keyboard activation can reopen the dialog',
  );
  await click('[data-binding-dialog] button');
  assert(
    await check(
      `!document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-bindings] button').textContent === 'Q'`,
    ),
    'Cancel preserves the current binding',
  );
  await click('[data-reset]');
  await click('[data-bindings] button');
  await pressKey('ArrowDown');
  assert(
    await check(
      `document.querySelector('[data-bindings] button').textContent === 'ARROWDOWN'`,
    ),
    'key capture takes precedence over arrow navigation',
  );
  await click('[data-reset]');
  await click('[data-back]');
  await click('[data-action="saves"]');
  assert(await check(`document.querySelector('[data-clear]').disabled`));
  await check(
    `document.querySelector('[data-import-id]').value = 'invalid'; document.querySelector('[data-import]').requestSubmit()`,
  );
  await pause(100);
  assert(
    await check(
      `document.querySelector('.ui-status').textContent.includes('valid private ID')`,
    ),
  );
  await click('[data-back]');
  await click('[data-action="credits"]');
  assert(
    await check(
      `document.querySelector('a[href="mailto:burntcustard@gmail.com"]') !== null`,
    ),
  );
  await click('[data-back]');

  await click('[data-action="play"]');
  await pause(6500);
  await capture('docked');
  assert.equal(errors().length, 0, errors().join('\n'));
  const savedToken = await check(`localStorage.getItem('playerToken')`);

  assert(savedToken);

  await c.send('Network.setBlockedURLs', { urls: ['*/api/identity'] });

  await c.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
  });

  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
  });

  await pause(800);
  await capture('saved-menu');
  assert.deepEqual(
    await check(
      `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.textContent.trim())`,
    ),
    ['RESUME', 'SETTINGS', 'CREDITS', 'DISCONNECT'],
    'the running menu offers Disconnect instead of Saves',
  );
  assert(
    await check(`(() => {
      const hint = document.querySelector('[data-resume-hint]');
      return hint.getClientRects().length && hint.textContent.trim() === 'ESC RESUME';
    })()`),
    'Escape hint offers Resume once the game is running',
  );
  assert(await check(`!document.querySelector('.ui-preview').hidden`));
  await checkShipPreview();

  const reopenMenu = async () => {
    await pause(100);
    await click(
      await check(
        `document.querySelector('[data-main-menu]') ? '[data-main-menu]' : '.ui-game-menu'`,
      ),
    );
  };

  await pressKey('Escape');
  assert(
    await check(`!document.querySelector('.ui-main')`),
    'Escape resumes from an unfocused main menu',
  );
  await reopenMenu();
  await pressKey('ArrowDown');
  assert(
    await check(`document.activeElement.matches('.ui-choice--large')`),
    'the resume menu has keyboard focus for the next Escape check',
  );
  await pressKey('Escape');
  assert(
    await check(`!document.querySelector('.ui-main')`),
    'Escape resumes from a focused main menu',
  );
  await reopenMenu();
  await click('[data-action="settings"]');
  await pressKey('Escape');
  assert(
    await check(
      `!document.querySelector('.ui-main').hidden && !document.querySelector('#settings-heading')`,
    ),
    'Escape in a submenu still goes back without resuming',
  );
  await pressKey('Escape');
  assert(await check(`!document.querySelector('.ui-main')`));
  await reopenMenu();
  await click('[data-action="play"]');
  assert(
    await check(`!document.querySelector('.ui-main')`),
    'Resume and Escape leave the same menu state',
  );
  assert.equal(await check(`localStorage.getItem('playerToken')`), savedToken);
  await reopenMenu();
  await c.send('Network.setBlockedURLs', { urls: [] });
  const disconnectPreferences = await check(
    `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
  );
  const disconnectEvents = c.events.length;

  await click('[data-action="disconnect"]');
  await pause(1000);
  assert.deepEqual(
    await check(
      `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.textContent.trim())`,
    ),
    ['PLAY', 'SAVES', 'SETTINGS', 'CREDITS'],
    'Disconnect returns to the starting menu',
  );
  assert.equal(await check(`localStorage.getItem('playerToken')`), savedToken);
  assert.deepEqual(
    await check(
      `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
    ),
    disconnectPreferences,
    'Disconnect preserves preferences',
  );
  assert(
    !c.events
      .slice(disconnectEvents)
      .some((event) => event.method === 'Network.webSocketCreated'),
    'Disconnect does not reconnect to gameplay',
  );
  assert(
    !(await check(
      `performance.getEntriesByType('resource').some(entry => /gameplay-/.test(entry.name))`,
    )),
    'Disconnect unloads gameplay',
  );
  await checkHiddenElements();
  await checkShipPreview();
  await click('[data-action="saves"]');
  await check(
    `document.querySelector('[data-import-id]').value = localStorage.getItem('playerToken'); document.querySelector('[data-import]').requestSubmit()`,
  );
  await pause(250);
  assert(await check(`document.querySelector('dialog').open`));
  await click('dialog button[value="cancel"]');
  assert.equal(await check(`localStorage.getItem('playerToken')`), savedToken);
  const preferences = await check(
    `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
  );
  const clearEvents = c.events.length;

  await click('[data-clear]');
  await pause(1000);
  assert(
    await check(
      `!localStorage.getItem('playerToken') && !localStorage.getItem('unicorn-preview')`,
    ),
    'clearing a save removes the local identity and cached ship',
  );
  assert.deepEqual(
    await check(
      `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
    ),
    preferences,
    'clearing a save preserves keybindings and graphics preferences',
  );
  assert(
    await check(
      `document.querySelector('[data-action="play"]').textContent.trim() === 'PLAY' && !document.querySelector('.ui-preview').hidden && document.querySelector('.ui-pilot').hidden`,
    ),
    'clearing a save returns to a fresh main menu',
  );
  await checkShipPreview();
  assert(
    !c.events
      .slice(clearEvents)
      .some(
        (event) =>
          event.method === 'Network.webSocketCreated' ||
          (event.method === 'Network.requestWillBeSent' &&
            event.params.request.url.includes('/api/')),
      ),
    'clearing a save does not contact the game server',
  );

  const preservedIdentity = await fetch('http://localhost:3000/api/identity', {
    method: 'POST',
    body: savedToken,
  });

  assert(preservedIdentity.ok, 'the cleared pilot remains on the server');
  await click('[data-action="saves"]');
  assert(await check(`document.querySelector('[data-clear]').disabled`));

  await check(
    `localStorage.setItem('playerToken', ${JSON.stringify(savedToken)})`,
  );
  await click('[data-back]');
  await c.send('Page.reload');
  await pause(1000);
  assert(await check(`!document.querySelector('.ui-preview').hidden`));
  assert(
    !(await check(
      `performance.getEntriesByType('resource').some(x=>/gameplay-/.test(x.name))`,
    )),
    'saved-ship preview does not fetch gameplay',
  );
  await capture('returning');
  await checkShipPreview();

  await c.send('Network.setBlockedURLs', { urls: ['*/api/identity'] });
  await c.send('Page.reload');
  await pause(1000);
  await checkShipPreview();
  await check(`localStorage.removeItem('unicorn-preview')`);
  await c.send('Network.setBlockedURLs', { urls: [] });
  await c.send('Page.reload');
  await pause(1000);
  await checkShipPreview();

  await c.send('Page.navigate', {
    url: 'http://localhost:3000/ui-fixture/index.html',
  });

  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );
  await pause(250);
  assert(await check(`!!document.querySelector('[data-sections]')`));
  await click('[data-sections] [data-key="0"]');
  const autogun = await check(
    `Array.from(document.querySelectorAll('[data-items] button')).find(x=>x.textContent.includes('AUTOGUN')).getAttribute('data-key')`,
  );

  await click(`[data-items] [data-key="${autogun}"]`);
  await click('[data-command="BUY"]');
  assert.deepEqual(await check(`fixture.inspect().slice(0,3)`), [
    1400,
    1,
    false,
  ]);
  assert(
    await check(`!document.querySelector('[data-command="EQUIP"]').hidden`),
    'purchased module remains selected',
  );
  await click('[data-command="EQUIP"]');
  assert.equal((await check(`fixture.inspect()`))[2], true);
  await check(`fixture.damage()`);
  assert(await check(`!document.querySelector('[data-command="FIX"]').hidden`));
  await click('[data-command="FIX"]');
  assert(await check(`document.querySelector('[data-command="FIX"]').hidden`));
  await checkHiddenElements();
  await click('[data-command="REMOVE"]');
  assert.equal((await check(`fixture.inspect()`))[2], false);
  await click('[data-command="SELL"]');
  assert.equal((await check(`fixture.inspect()`))[1], 1);
  await click('[data-sections] [data-key="-1"]');
  await click('[data-paints] button:nth-child(6)');
  assert(
    await check(
      `document.querySelector('[data-paints] button:nth-child(6)').getAttribute('aria-pressed') === 'true'`,
    ),
  );
  await check(
    `document.querySelector('[data-sections] [data-key="-1"]').focus(); window.focusedRow = document.activeElement; fixture.refresh()`,
  );
  assert(
    await check(`document.activeElement === focusedRow`),
    'updates preserve focus',
  );

  await capture('docked-desktop');
  await pressKey('Escape');
  assert.equal((await check(`fixture.inspect()`))[3], true);
  assert(!(await check(`!!document.querySelector('[data-sections]')`)));
  await c.send('Page.reload');
  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );
  await pause(250);
  await check(`document.activeElement.blur()`);
  await pressKey('Escape');
  assert.equal(
    (await check(`fixture.inspect()`))[3],
    true,
    'Escape requests launch even without a focused station control',
  );
  assert(!(await check(`!!document.querySelector('[data-sections]')`)));
  console.log(
    'Production UI: deferred startup, navigation, preferences, identity verification, preview, desktop layout, trading, repairs, paint, focus and launch passed.',
  );
  assert.equal(errors().length, 0, errors().join('\n'));
} finally {
  for (const ws of sockets) ws.close();

  if (chrome.pid && chrome.exitCode === null) {
    const exit = once(chrome, 'exit');

    process.kill(-chrome.pid, 'SIGTERM');
    await exit;
  }

  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });

  await rm(fixtureDirectory, { recursive: true, force: true });
}
