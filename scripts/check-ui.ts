import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../plugins/build-plugins.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';

type CdpReply = Record<string, any>;

// Run after a production build, with the standard game server and frontend running.
// Browser interception serves built assets without replacing a running frontend.
const rootDirectory = process.cwd();
const fixturePath = `ui-fixture-${process.pid}`;
const fixtureDirectory = resolve('dist', fixturePath);
const entryId = resolve('src/__dom_fixture.ts');
const fixtureModules = new Map(
  await Promise.all(
    ['dom-ui', 'graphics'].map(
      async (name) =>
        [
          resolve(`src/__${name}_fixture.ts`),
          (await readFile(`tests/fixtures/${name}.ts`, 'utf8')).replaceAll(
            '../../src/',
            `${rootDirectory}/src/`,
          ),
        ] as const,
    ),
  ),
);
const fixtureCode = [...fixtureModules.keys()]
  .map((path) => `export * from '${path}';`)
  .join('\n');

const bundle = await rolldown({
  input: entryId,
  plugins: [
    {
      name: 'dom-fixture',
      resolveId(id) {
        if (id === entryId || fixtureModules.has(id)) return id;
      },
      async load(id) {
        if (id === entryId) return fixtureCode;

        if (fixtureModules.has(id)) return fixtureModules.get(id);

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

const stylesheets = (await readdir('dist'))
  .filter((name) => name.endsWith('.css'))
  // Match real loading order: the entry stylesheet declares CSS layer priority
  // before gameplay and docked component styles arrive.
  .sort((a, b) => {
    const priority = (name: string) =>
      name.startsWith('index-') ? 0 : name.startsWith('docked-') ? 2 : 1;

    return priority(a) - priority(b);
  });

const productionCss = (
  await Promise.all(stylesheets.map((name) => readFile(`dist/${name}`, 'utf8')))
).join('');

assert(
  !/\.mx-1\b/.test(productionCss),
  'production builds remove unused CSS utilities',
);
assert(
  productionCss.includes('.dock-empty') &&
    productionCss.includes('.ui-notification'),
  'production CSS retains dynamically applied classes',
);
assert(
  /ui-highlight:is\([^)]*hover/.test(productionCss),
  'production CSS retains browser interaction states inside functional selectors',
);

await writeFile(
  `${fixtureDirectory}/index.html`,
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheets.map((name) => `<link rel="stylesheet" href="../${name}">`).join('')}</head><body><canvas id="canvas"></canvas><script type="module" src="fixture.js"></script></body></html>`,
);
const profile = await mkdtemp('/tmp/unicorn-ui-browser-');
const chrome = spawn(
  process.env.CHROME_BIN || 'chromium',
  [
    ...(process.env.UI_HEADFUL ? [] : ['--headless=new']),
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    // Intercepted documents lack the loopback address-space classification.
    '--disable-features=LocalNetworkAccessChecks',
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sockets: WebSocket[] = [];

const connect = async (url: string) => {
  const ws = new WebSocket(url);

  sockets.push(ws);
  await once(ws, 'open');
  let seq = 0;

  const pending = new Map<
    number,
    { resolve: (result: CdpReply) => void; reject: (error: Error) => void }
  >();

  const events: CdpReply[] = [];
  const listeners: ((event: CdpReply) => void)[] = [];

  ws.on('message', (data) => {
    const msg = JSON.parse((data as Buffer).toString());

    if (msg.id) {
      const p = pending.get(msg.id);

      pending.delete(msg.id);
      msg.error
        ? p.reject(new Error(JSON.stringify(msg.error)))
        : p.resolve(msg.result);
    } else {
      events.push(msg);
      listeners.forEach((listener) => listener(msg));
    }
  });

  return {
    events,
    onEvent: (listener: (event: CdpReply) => void) => listeners.push(listener),
    send: (method: string, params: object = {}) =>
      new Promise<CdpReply>((resolve, reject) => {
        const id = ++seq;

        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
  };
};

const evaluate = async (
  c: Awaited<ReturnType<typeof connect>>,
  expression: string,
) => {
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

checkUi: try {
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

  const targets: { id: string; webSocketDebuggerUrl: string }[] = await fetch(
    `http://${host}/json/list`,
  ).then((r) => r.json());

  const c = await connect(
    targets.find((t) => t.id === targetId).webSocketDebuggerUrl,
  );

  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  let heldResource: RegExp;

  c.onEvent((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;

    if (heldResource?.test(path)) return;

    if (path.startsWith('/api/') || path.startsWith('/game-socket')) {
      void c.send('Fetch.continueRequest', { requestId });
      return;
    }

    const file = resolve('dist', `.${path === '/' ? '/index.html' : path}`);

    void (async () => {
      let body: Buffer;

      try {
        assert(file.startsWith(`${resolve('dist')}${sep}`));
        body = await readFile(file);
      } catch {
        await c.send('Fetch.fulfillRequest', { requestId, responseCode: 404 });
        return;
      }

      await c.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          {
            name: 'Content-Type',
            value: contentTypes[extname(file)] || 'application/octet-stream',
          },
        ],
        body: body.toString('base64'),
      });
    })();
  });

  await c.send('Fetch.enable', {
    patterns: [{ urlPattern: 'http://localhost:3000/*' }],
  });

  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Network.enable');
  await c.send('Page.enable');

  const { identifier: menuFrameScript } = await c.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `window.audioContexts = 0;
      const OriginalAudioContext = AudioContext;
      window.AudioContext = class extends OriginalAudioContext {
        constructor(...args) { super(...args); window.audioContexts++; }
      };
      window.gameFrames = 0;
      const clearRect = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) {
        if (this.canvas.id === 'canvas') window.gameFrames++;
        if (this.canvas.matches('.ui-preview') && !window.previewFrame) window.previewFrame = performance.now();
        return clearRect.apply(this, args);
      };
      const clear = WebGL2RenderingContext.prototype.clear;
      WebGL2RenderingContext.prototype.clear = function(...args) {
        if (this.canvas.id === 'canvas') window.gameFrames++;
        return clear.apply(this, args);
      };
      new MutationObserver((_, observer) => {
        if (!document.querySelector('.ui-main')) return;
        observer.disconnect();
        requestAnimationFrame(() => { window.menuFrame = performance.now(); });
      }).observe(document, { childList: true, subtree: true });`,
    },
  );

  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await c.send('Page.navigate', { url: 'http://localhost:3000' });
  await pause(700);
  const check = (expression: string) => evaluate(c, expression);

  const waitFor = async (expression: string, message: string) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await check(expression)) return;
      await pause(100);
    }

    assert.fail(
      `${message}\n${JSON.stringify(c.events.filter((event) => /webSocketFrameError|loadingFailed|exceptionThrown/.test(event.method)).slice(-10)).slice(0, 6000)}`,
    );
  };

  const checkHiddenElements = async () => {
    assert(
      await check(
        `[...document.querySelectorAll('[hidden]')].every(element => !element.getClientRects().length)`,
      ),
      'hidden elements have no layout boxes',
    );
  };

  const pressKey = async (
    key: string,
    { shift = false, repeat = false } = {},
  ) => {
    for (const type of ['keyDown', 'keyUp']) {
      await c.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key,
        modifiers: shift ? 8 : 0,
        autoRepeat: repeat,
        text: key === 'Enter' && type === 'keyDown' ? '\r' : undefined,
        windowsVirtualKeyCode: new Map([
          ['Enter', 13],
          ['Escape', 27],
          ['Tab', 9],
          [' ', 32],
        ]).get(key),
      });
    }
  };

  const hover = async (selector: string) => {
    const [x, y] = await check(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center' });
      const box = element.getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);

    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    return [x, y];
  };

  const click = async (selector: string) => {
    const [x, y] = await hover(selector);

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

  const openMenuScreen = async (destination: string) => {
    await click(`[data-action="${destination}"]`);
    await waitFor(
      `!!document.querySelector('#${destination}-heading')`,
      `${destination} screen loads on navigation`,
    );
  };

  const checkShipPreview = async () => {
    await waitFor(
      `(() => {
        const canvas = document.querySelector('.ui-preview');
        return canvas && !canvas.hidden && canvas.width > 300 && getComputedStyle(canvas).opacity === '1';
      })()`,
      'the deferred ship preview finishes loading and fading in',
    );
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
      bounds.slice(3).every((margin: number) => margin > 0),
      'ship is not clipped',
    );
  };

  const capture = async (name: string) => {
    assert(
      await check(`Array.from(document.querySelectorAll('.ui-card:not(.hud-stores-panel)')).every(panel => {
      const style = getComputedStyle(panel);
      return ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].every(side => style.getPropertyValue(side) === '16px');
    })`),
      `${name}: all panels use shared 16px padding`,
    );

    await check(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });

    const directory = process.env.UI_CAPTURE_DIR || profile;

    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/${name}.png`, Buffer.from(data, 'base64'));
  };

  const errors = () =>
    c.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map(
        (e) =>
          e.params.exceptionDetails.exception?.description ||
          e.params.exceptionDetails.text,
      );

  if (!process.env.UI_DOCK_ONLY) {
    assert(
      await check(
        `document.querySelectorAll('.hud').length === 1 && !document.querySelector('#ui-root')`,
      ),
    );
    assert.equal(errors().length, 0, errors().join('\n'));
    assert(
      await check(`!!document.querySelector('.ui-main')`),
      'the main menu mounts before startup checks',
    );
    assert.deepEqual(
      await check(`(() => {
        const surface = document.createElement('div');
        surface.className = 'ui-surface';
        surface.innerHTML = '<p class="text-muted mt-4 mr-2 mb-2">Muted paragraph</p><span class="text-muted">Muted caption</span>';
        document.body.append(surface);
        const paragraph = getComputedStyle(surface.firstElementChild);
        const caption = getComputedStyle(surface.lastElementChild);
        const result = [paragraph.marginTop, paragraph.marginRight,
          paragraph.marginBottom, paragraph.marginLeft, paragraph.color === caption.color];
        document.body.removeChild(surface);
        return result;
      })()`),
      ['16px', '8px', '8px', '0px', true],
      'directional margin utilities retain their spacing, and muted paragraphs match muted captions',
    );
    await checkHiddenElements();
    await capture('menu');
    assert.equal(
      await check(
        `performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('.js') && entry.startTime <= window.menuFrame).length`,
      ),
      1,
      'only the JavaScript entry is requested before the first menu frame',
    );
    assert(
      !c.events.some(
        (event) =>
          event.method === 'Network.requestWillBeSent' &&
          /\/menu-screens-[\w-]+\.js/.test(event.params.request.url),
      ),
      'the initial menu requests no submenu code',
    );
    assert.deepEqual(
      await check(
        `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.querySelector('span:not([data-trade-action])').textContent.trim())`,
      ),
      ['Play', 'Saves', 'Settings', 'Credits'],
      'the starting menu offers Play, Saves, Settings, and Credits',
    );
    assert(
      await check(`document.activeElement === document.body`),
      'opening the menu does not assign focus',
    );
    await pressKey('ArrowDown');
    assert(
      await check(
        `document.activeElement === document.querySelector('[data-action="play"]')`,
      ),
      'Down starts navigation from an unfocused menu',
    );
    await waitFor(
      `getComputedStyle(document.activeElement, '::before').opacity === '1' && getComputedStyle(document.activeElement.firstElementChild).transform === 'matrix(1, 0, 0, 1, 8, 0)'`,
      'arrow focus uses the main-menu hover appearance',
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
        `document.activeElement === document.querySelector('[data-action="saves"]') && getComputedStyle(document.activeElement).outlineStyle === 'none'`,
      ),
      'main-menu keyboard focus uses the highlight without an outline',
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
        `document.activeElement === document.querySelector('[data-action="saves"]') && getComputedStyle(document.querySelector('[data-action="play"]')).outlineStyle === 'none'`,
      ),
      'hovering main-menu text preserves keyboard focus without adding an outline',
    );
    assert(
      await check(
        `performance.getEntriesByType('resource').some(entry => /gameplay-/.test(entry.name) && entry.startTime >= window.previewFrame)`,
      ),
      'gameplay preparation starts after the preview draws',
    );
    await checkShipPreview();
    assert(
      await check(
        `performance.getEntriesByType('resource').some(entry => entry.name.includes('/ship-preview-') && entry.startTime >= window.menuFrame)`,
      ),
      'the ship preview is requested after the first menu frame',
    );
    await waitFor(
      `!!localStorage.getItem('playerToken')`,
      'preparation receives the new pilot identity',
    );
    assert(
      await check(
        `document.querySelector('.ui-pilot').hidden && !!localStorage.getItem('playerToken') && !localStorage.getItem('unicorn-preview')`,
      ),
      'preparation creates a pilot while preserving the default preview',
    );
    assert(
      c.events.some((event) => event.method === 'Network.webSocketCreated'),
      'the main menu connects to the game server before Play',
    );
    await waitFor(
      `['gameplay', 'docked', 'sound'].every(name => performance.getEntriesByType('resource').some(entry => entry.name.includes('/' + name + '-') && entry.name.endsWith('.js'))) && performance.getEntriesByType('resource').some(entry => /docked-.*\\.css/.test(entry.name))`,
      'the main menu preloads gameplay, docking CSS and audio',
    );
    assert.equal(
      await check('window.gameFrames'),
      0,
      'preparation does not start the game loop',
    );
    assert.equal(
      await check('window.audioContexts'),
      0,
      'preparation does not initialize audio',
    );
    assert(
      c.events
        .filter((event) => event.method === 'Network.webSocketFrameReceived')
        .every(
          (event) =>
            Buffer.from(event.params.response.payloadData, 'base64')[1] !==
            0x4d,
        ),
      'the prepared connection receives no world snapshots before Play',
    );
    assert(
      c.events.some(
        (event) =>
          event.method === 'Network.webSocketFrameSent' &&
          Buffer.from(event.params.response.payloadData, 'base64')[3] === 8,
      ),
      'the menu authenticates with a preparation request',
    );
    const preparedSockets = c.events.filter(
      (event) => event.method === 'Network.webSocketCreated',
    ).length;

    await openMenuScreen('settings');
    assert.equal(
      await check(
        `[...document.querySelectorAll('[data-bindings] > *')].find(row => row.textContent.startsWith('Target next object')).textContent.trim()`,
      ),
      'Target next objectt',
      'targeting appears in Settings with T as its default',
    );
    await capture('settings');
    const settingsLayout = await check(`(() => {
      const bounds = element => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      };
      const panel = document.querySelector('.ui-settings');
      const content = document.querySelector('.ui-control-panel');
      return [bounds(panel), bounds(panel.querySelector('header')), bounds(panel.querySelector('nav')), bounds(content)];
    })()`);

    assert(
      Math.abs(settingsLayout[3][2] - (settingsLayout[0][2] - 80 - 48) / 3) < 1,
      'settings content occupies one of three equal grid columns',
    );
    assert(
      await check(
        `(() => {
          const panel = document.querySelector('.ui-control-panel');
          const bounds = [...panel.children].map(element => element.getBoundingClientRect());
          return bounds.slice(1).every((box, index) => Math.abs(box.top - bounds[index].bottom - 16 - parseFloat(getComputedStyle(panel.children[index + 1]).marginTop)) < 1)
            && getComputedStyle(panel.querySelector('[data-reset]')).marginTop === '0px';
        })()`,
      ),
      'the controls grid spaces instructions, bindings and reset without button margins',
    );
    assert(
      await check(
        `document.querySelector('#settings-heading').textContent === 'Settings' && getComputedStyle(document.querySelector('#settings-heading')).textTransform === 'uppercase'`,
      ),
      'settings uses readable source text and CSS uppercase styling',
    );
    assert(
      await check(
        `getComputedStyle(document.querySelector('[data-bindings] button')).textTransform === 'uppercase'`,
      ),
      'binding buttons display uppercase without changing their source text',
    );
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
      await check(
        `document.activeElement === document.querySelector('[data-controls]')`,
      ),
      'hovering a submenu item preserves the previously focused item',
    );

    const readTabStyle = async () => {
      await waitFor(
        `getComputedStyle(document.querySelector('[data-graphics]')).borderBottomColor === 'rgb(238, 238, 255)'`,
        'the tab underline finishes its hover or focus transition',
      );
      return check(`(() => {
    const style = getComputedStyle(document.querySelector('[data-graphics]'));
    return [style.outlineStyle, style.borderBottomWidth, style.borderBottomColor];
  })()`);
    };

    const hoverTab = await readTabStyle();

    assert.deepEqual(hoverTab, ['none', '3px', 'rgb(238, 238, 255)']);

    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 0,
      y: 0,
    });

    await pressKey('ArrowRight');
    assert(
      await check(
        `document.activeElement === document.querySelector('[data-graphics]') && document.activeElement.matches(':focus-visible')`,
      ),
      'arrow navigation shows keyboard focus',
    );
    assert.deepEqual(
      await readTabStyle(),
      hoverTab,
      'keyboard focus uses the same visible underline as hover',
    );
    assert(
      await check(
        `getComputedStyle(document.querySelector('[data-controls]')).borderBottomColor !== getComputedStyle(document.querySelector('[data-graphics]')).borderBottomColor`,
      ),
      'the selected tab remains visually distinct from the focused tab',
    );
    assert(
      await check(
        `document.querySelector('[data-controls]').getAttribute('aria-current') === 'page'`,
      ),
      'moving focus does not change selection',
    );
    await pressKey('Enter');
    assert(
      await check(
        `document.querySelector('[data-graphics]').getAttribute('aria-current') === 'page'`,
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
    assert.deepEqual(
      await check(
        `[...document.querySelector('[data-renderer]').options].map(option => option.value)`,
      ),
      ['canvas', 'webgl'],
      'either renderer is available independently of browser',
    );
    await check(
      `document.querySelector('[data-renderer]').value = 'webgl'; document.querySelector('[data-renderer]').dispatchEvent(new Event('change'));`,
    );
    assert.equal(
      await check(`localStorage.getItem('unicorn-renderer')`),
      'webgl',
    );
    assert(
      await check(
        `document.querySelector('.ui-status').textContent.includes('Reload')`,
      ),
    );
    await check(
      `document.querySelector('[data-renderer]').value = 'canvas'; document.querySelector('[data-renderer]').dispatchEvent(new Event('change'));`,
    );
    assert.equal(
      await check(`document.querySelector('[data-hud-resolution]').value`),
      'native',
      'HUD defaults to native display resolution',
    );

    for (const value of ['world', 'native']) {
      await check(
        `document.querySelector('[data-hud-resolution]').value = '${value}'; document.querySelector('[data-hud-resolution]').dispatchEvent(new Event('change'));`,
      );
      assert.equal(
        await check(`localStorage.getItem('unicorn-native-hud')`),
        String(value === 'native'),
        'HUD resolution persists independently of world settings',
      );
    }

    assert(
      await check(`(() => {
    const selected = getComputedStyle(document.querySelector('[data-graphics]'));
    const other = getComputedStyle(document.querySelector('[data-controls]'));
    return selected.borderBottomColor !== other.borderBottomColor && selected.color !== other.color && selected.webkitTextStrokeWidth === '0px';
  })()`),
      'selected tabs have an accent underline and text without the light-text stroke',
    );
    await capture('graphics');
    assert.deepEqual(
      await check(`['.ui-settings', '.ui-settings header', '.ui-settings .ui-tabs', '[data-graphics-panel]'].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    })`),
      settingsLayout,
      'settings stays fixed when switching between panels',
    );
    await click('[data-graphic="1"]');
    assert(
      await check(
        `JSON.parse(localStorage.getItem('unicorn-graphics'))[1] === false`,
      ),
    );
    assert.equal(
      await check(
        `JSON.parse(localStorage.getItem('unicorn-graphics')).length`,
      ),
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
    assert(
      await check(`(() => {
        const canvas = document.querySelector('.background-layer');
        return canvas && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value);
      })()`),
      'the prepared menu redraws its background after graphics changes',
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
        `document.querySelector('[data-bindings] button').textContent === 'q'`,
      ),
    );
    assert(
      await check(
        `!document.querySelector('[data-binding-dialog]').open && JSON.parse(localStorage.getItem('unicorn-controls'))[0][0] === 'q'`,
      ),
      'a valid key is persisted and closes the dialog',
    );
    assert(
      await check(`(() => {
        const buttons = [...document.querySelectorAll('[data-bindings] button')];
        return buttons.every(button => {
          const {width, height} = button.getBoundingClientRect();
          return button.textContent.length === 1
            ? Math.abs(width - height) < 1
            : width >= height;
        });
      })()`),
      'single-character bindings are square and longer bindings can grow wider',
    );

    await click('[data-bindings] button');
    await pressKey('Escape');
    assert(
      await check(
        `!document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-bindings] button').textContent === 'q' && !document.querySelector('[data-controls]').closest('.ui-settings').hidden`,
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
        `!document.querySelector('[data-binding-dialog]').open && document.querySelector('[data-bindings] button').textContent === 'q'`,
      ),
      'Cancel preserves the current binding',
    );
    await click('[data-reset]');
    await click('[data-bindings] button');
    await pressKey('ArrowDown');
    assert(
      await check(
        `document.querySelector('[data-bindings] button').textContent === '↓'`,
      ),
      'key capture takes precedence over arrow navigation',
    );
    await click('[data-reset]');
    const targetingIndex = await check(`(() => {
      const rows = [...document.querySelectorAll('[data-bindings] > *')];
      const index = rows.findIndex(row => row.textContent.startsWith('Target next object'));
      rows[index].querySelector('button').setAttribute('data-target-binding', '');
      return JSON.parse(localStorage.getItem('unicorn-controls')).findIndex(keys => keys.includes('t'));
    })()`);

    await click('[data-target-binding]');
    await pressKey('n');
    assert.equal(
      await check(
        `JSON.parse(localStorage.getItem('unicorn-controls'))[${targetingIndex}][0]`,
      ),
      'n',
      'targeting can be rebound and saved',
    );
    await click('[data-back]');
    await openMenuScreen('saves');
    await check(`document.querySelector('[data-import-id]').focus()`);
    await hover('[data-verify]');
    assert(
      await check(
        `document.activeElement === document.querySelector('[data-import-id]')`,
      ),
      'hovering a button preserves text-entry focus',
    );

    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 10,
      y: 10,
    });

    assert(
      await check(
        `document.activeElement === document.querySelector('[data-import-id]')`,
      ),
      'hovering the page background preserves text-entry focus',
    );

    await capture('saves');
    assert(await check(`!document.querySelector('[data-clear]').disabled`));
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
    await openMenuScreen('credits');
    assert(
      await check(
        `document.querySelector('a[href="mailto:burntcustard@gmail.com"]').getClientRects().length > 0`,
      ),
    );
    await capture('credits');
    await click('[data-back]');

    const playEvents = c.events.length;

    await click('[data-action="play"]');
    await waitFor(
      `!!document.querySelector('#profile-name')`,
      'first Play opens profile creation',
    );
    assert.equal(
      await check('window.gameFrames || 0'),
      0,
      'profile creation waits before entering the world',
    );
    assert(
      await check(
        `document.activeElement === document.querySelector('#profile-name')`,
      ),
      'profile input receives keyboard focus',
    );
    await check(`(() => {
      const input = document.querySelector('#profile-name');
      input.value = '🦄'.repeat(17);
      input.dispatchEvent(new Event('input'));
    })()`);
    assert(
      await check(`!document.querySelector('#profile-name').checkValidity()`),
      '17 Unicode characters are rejected',
    );
    await check(`(() => {
      const input = document.querySelector('#profile-name');
      input.value = '🦄'.repeat(16);
      input.dispatchEvent(new Event('input'));
    })()`);
    assert(
      await check(`document.querySelector('#profile-name').checkValidity()`),
      '16 Unicode characters are accepted',
    );
    await check(`(() => {
      const input = document.querySelector('#profile-name');
      input.value = 'asterPilot🦄<&';
      input.dispatchEvent(new Event('input'));
    })()`);
    await capture('profile');
    await check(`document.querySelector('.ui-profile').requestSubmit()`);
    await pause(6500);
    assert.equal(
      c.events
        .slice(playEvents)
        .filter(
          (event) =>
            event.method === 'Network.webSocketFrameSent' &&
            Buffer.from(event.params.response.payloadData, 'base64')[3] === 9,
        ).length,
      1,
      'Play sends one world-entry request on the prepared connection',
    );
    assert.equal(
      c.events.filter((event) => event.method === 'Network.webSocketCreated')
        .length,
      preparedSockets,
      'Play reuses the prepared connection',
    );
    assert(await check('window.gameFrames > 0'), 'Play starts the game loop');
    await waitFor(
      `document.querySelector('#connection-status').hidden`,
      'game connection stays available after profile creation',
    );
    await check(`(() => {
      window.targetLabels = [];
      window.targetAlphas = [];
      const isHud = canvas => canvas.id === 'canvas' || canvas.classList.contains('foreground-hud');
      const paths = new WeakMap();
      const labels = new WeakMap();
      const moveTo = Path2D.prototype.moveTo;
      Path2D.prototype.moveTo = function(x, y) {
        if (!paths.has(this)) paths.set(this, []);
        paths.get(this).push([x, y]);
        return moveTo.call(this, x, y);
      };
      const stroke = CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke = function(...args) {
        const path = args[0];
        const points = paths.get(path);
        if (isHud(this.canvas) && this.strokeStyle === '#ee66ff' && points?.length === 6) {
          const transform = this.getTransform();
          const screenPoints = points.map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
          window.targetBox = [Math.min(...screenPoints.map(p => p.x)), Math.max(...screenPoints.map(p => p.x)), Math.min(...screenPoints.map(p => p.y)), Math.max(...screenPoints.map(p => p.y))];
          window.targetAlphas.push(this.globalAlpha);
          if (this.globalAlpha === 0.9) window.targetLabelPending = true;
        }
        return stroke.apply(this, args);
      };
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(...args) {
        if (!isHud(this.canvas)) labels.set(this.canvas, args[0]);
        if (isHud(this.canvas) && window.targetLabelPending) {
          window.targetLabels.push(args[0]);
          window.targetLabelPending = false;
        }
        return fillText.apply(this, args);
      };
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        const label = labels.get(args[0]);
        if (isHud(this.canvas) && window.targetLabelPending && label) {
          window.targetLabels.push(label);
          window.targetLabelPending = false;
        }
        return drawImage.apply(this, args);
      };
    })()`);
    await pressKey('t');
    await pause(100);
    assert.equal(
      await check('window.targetLabels.length'),
      0,
      'rebinding removes T as a hidden target key',
    );
    let hoverPoint: number[];

    for (const y of [100, 300, 500, 700]) {
      for (const x of [100, 300, 500, 700, 900, 1100]) {
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await pause(40);

        if (await check('!!window.targetBox')) {
          hoverPoint = [x, y];
          break;
        }
      }

      if (hoverPoint) break;
    }

    assert(hoverPoint, 'hover finds a visible world object');
    assert.equal(
      await check('window.targetLabels.length'),
      0,
      'hover hides names',
    );
    assert(
      await check('window.targetAlphas.every(alpha => alpha === 0.5)'),
      'hover corners use 50 percent opacity',
    );
    await capture('world-hover');

    for (const type of ['mousePressed', 'mouseReleased']) {
      await c.send('Input.dispatchMouseEvent', {
        type,
        x: hoverPoint[0],
        y: hoverPoint[1],
        button: 'left',
        clickCount: 1,
      });
    }

    await waitFor(
      'window.targetLabels.length > 0',
      'click targeting shows the object name',
    );
    assert.equal(
      await check('window.targetAlphas.at(-1)'),
      0.9,
      'click targeting uses 90 percent opacity',
    );
    await capture('targeting');
    assert(
      await check(
        `document.querySelector('.hud-sector [data-sector]').textContent === 'Patroclus' && document.querySelectorAll('.hud-modules kbd').length > 0`,
      ),
      'live production flight HUD shows sector and fitted module shortcuts',
    );

    assert(
      await check(`(() => {
        const root = document.querySelector('.hud');
        return document.querySelectorAll('.hud').length === 1 && !document.querySelector('#ui-root') &&
          !document.querySelector('.hud-instruments') &&
          ['.hud-left', '.hud-right', '.hud-sector', '.hud-map'].every(selector => document.querySelector(selector).parentElement === root) &&
          document.querySelector('.game-chat').parentElement === root &&
          document.querySelector('.ui-notification').parentElement === root;
      })()`),
      'instruments, chat, and notifications share one HUD parent',
    );

    const moduleButton = '.hud-modules > button';
    const beforeToggle = await check(
      `document.querySelector('${moduleButton}').getAttribute('aria-pressed')`,
    );

    await click(moduleButton);
    await waitFor(
      `document.querySelector('${moduleButton}').getAttribute('aria-pressed') !== '${beforeToggle}'`,
      'clicking a module shortcut updates predicted and replicated module state',
    );
    await pressKey('h');
    await waitFor(
      `document.querySelector('${moduleButton}').getAttribute('aria-pressed') === '${beforeToggle}'`,
      'keyboard and clickable module controls share state',
    );

    await hover('[data-store="fuel"] > button');
    assert(
      await check(
        `getComputedStyle(document.querySelector('#hud-fuel-tooltip')).display === 'block' && document.querySelector('#hud-fuel-tooltip').textContent.includes(' L') && !document.querySelector('#hud-fuel-tooltip').textContent.includes('segment')`,
      ),
      'fuel icon reveals the exact fuel volume on hover',
    );
    await capture('hud-fuel-tooltip');

    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 600,
      y: 400,
    });

    for (const [width, height] of [
      [1680, 942],
      [800, 700],
    ]) {
      await c.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      await pause(250);
      assert(
        await check(`['.hud-left', '.hud-right', '.hud-sector', '.hud-stores', '.hud-map'].every(selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
      })`),
        `flight instruments fit ${width}px viewport`,
      );

      assert(
        await check(`Array.from(document.querySelectorAll('.hud-widget.ui-card, .hud-widget .ui-card:not(.hud-stores-panel), .game-chat')).every(panel => {
        const style = getComputedStyle(panel);
        return panel.classList.contains('ui-card') && ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].every(side => style[side] === '16px');
      })`),
        `shared panel padding stays 16px at ${width}px`,
      );

      assert(
        await check(`(() => {
          return Array.from(document.querySelectorAll('.hud-stores [role="meter"]')).every(bar => {
            const store = bar.closest('[data-store]').getBoundingClientRect();
            return bar.getBoundingClientRect().right <= store.right;
          });
        })()`),
        `all meters stay inside their instrument rows at ${width}px`,
      );

      await capture(`hud-${width}`);
    }

    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await pause(250);

    await check(
      `document.querySelector('#canvas').dispatchEvent(new PointerEvent('pointerleave')); window.targetLabels = []; window.targetAlphas = []`,
    );
    await waitFor(
      'window.targetLabels.length > 0',
      'leaving the canvas preserves targeted corners and name',
    );
    assert(
      await check('window.targetAlphas.every(alpha => alpha === 0.9)'),
      'leaving the canvas clears hover while preserving targeting opacity',
    );

    await check('window.targetLabels = []');
    await pressKey('n');
    await waitFor(
      'window.targetLabels.length > 0',
      'the rebound target key targets a world object',
    );
    await capture('docked');
    assert.equal(errors().length, 0, errors().join('\n'));
    const savedToken = await check(`localStorage.getItem('playerToken')`);

    assert(savedToken);

    const namedIdentity = await fetch('http://localhost:3000/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: savedToken,
    }).then((response) => response.json());

    assert.equal(
      namedIdentity[0],
      'asterPilot🦄<&',
      'server stores the original Unicode profile name',
    );

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
    assert.equal(
      await check(`document.querySelector('[data-pilot]').textContent`),
      'asterPilot□□□',
      'main menu shows the saved profile with fallback glyphs',
    );
    await pressKey('Escape', { repeat: true });
    assert(
      await check(`!!document.querySelector('.ui-main')`),
      'holding Escape after opening the menu does not resume gameplay',
    );

    assert.deepEqual(
      await check(
        `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.querySelector('span:not([data-trade-action])').textContent.trim())`,
      ),
      ['Resume', 'Settings', 'Credits', 'Disconnect'],
      'the running menu offers Disconnect instead of Saves',
    );
    assert(
      await check(`(() => {
      const hint = document.querySelector('[data-resume-hint]');
      return hint.getClientRects().length && hint.querySelector('kbd').textContent === 'Esc' && hint.textContent.trim().endsWith('Resume');
    })()`),
      'Escape hint offers Resume once the game is running',
    );
    assert(await check(`!document.querySelector('.ui-preview').hidden`));
    await checkShipPreview();

    const reopenMenu = async () => {
      await pause(100);

      await c.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 640,
        y: 40,
      });

      if (await check(`Boolean(document.querySelector('.dock-screen'))`)) {
        await pressKey('Escape');
        await pause(800);
        assert(
          await check(`!document.querySelector('.dock-screen, .ui-main')`),
        );
      }

      await pressKey('Escape');
      assert(await check(`Boolean(document.querySelector('.ui-main'))`));
    };

    await pressKey('Escape');
    assert(
      await check(`!document.querySelector('.ui-main')`),
      'Escape resumes from an unfocused main menu',
    );
    await pressKey('Escape', { repeat: true });
    assert(
      await check(`!document.querySelector('.ui-main')`),
      'holding Escape after resuming does not reopen the menu',
    );

    await reopenMenu();
    await pressKey('ArrowDown');
    assert(
      await check(`document.activeElement.matches('.ui-choice')`),
      'the resume menu has keyboard focus for the next Escape check',
    );
    await pressKey('Escape');
    assert(
      await check(`!document.querySelector('.ui-main')`),
      'Escape resumes from a focused main menu',
    );
    await reopenMenu();
    await openMenuScreen('settings');
    await pressKey('Escape');
    assert(
      await check(
        `!document.querySelector('.ui-main').hidden && !document.querySelector('#settings-heading')`,
      ),
      'Escape in a submenu still goes back without resuming',
    );
    await pressKey('Escape', { repeat: true });
    assert(
      await check(`!!document.querySelector('.ui-main')`),
      'holding Escape after leaving a submenu does not resume gameplay',
    );

    await pressKey('Escape');
    assert(await check(`!document.querySelector('.ui-main')`));
    await reopenMenu();
    await click('[data-action="play"]');
    assert(
      await check(`!document.querySelector('.ui-main')`),
      'Resume and Escape leave the same menu state',
    );
    assert.equal(
      await check(`localStorage.getItem('playerToken')`),
      savedToken,
    );
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
        `Array.from(document.querySelectorAll('.ui-menu button')).filter(button => button.getClientRects().length).map(button => button.querySelector('span:not([data-trade-action])').textContent.trim())`,
      ),
      ['Play', 'Saves', 'Settings', 'Credits'],
      'Disconnect returns to the starting menu',
    );
    assert.equal(
      await check(`localStorage.getItem('playerToken')`),
      savedToken,
    );
    assert.deepEqual(
      await check(
        `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
      ),
      disconnectPreferences,
      'Disconnect preserves preferences',
    );
    assert(
      c.events
        .slice(disconnectEvents)
        .some((event) => event.method === 'Network.webSocketCreated'),
      'returning to the main menu prepares a new connection',
    );
    assert(
      await check('window.gameFrames === 0'),
      'returning to the main menu keeps the game loop stopped',
    );
    await checkHiddenElements();
    await checkShipPreview();
    await openMenuScreen('saves');
    await check(
      `document.querySelector('[data-import-id]').value = localStorage.getItem('playerToken'); document.querySelector('[data-import]').requestSubmit()`,
    );
    await pause(250);
    assert(await check(`document.querySelector('dialog').open`));
    await click('dialog button[value="cancel"]');
    assert.equal(
      await check(`localStorage.getItem('playerToken')`),
      savedToken,
    );
    const preferences = await check(
      `[localStorage.getItem('unicorn-controls'), localStorage.getItem('unicorn-graphics')]`,
    );
    const clearEvents = c.events.length;

    await click('[data-clear]');
    await pause(1000);
    assert(
      await check(
        `localStorage.getItem('playerToken') !== ${JSON.stringify(savedToken)} && !localStorage.getItem('unicorn-preview')`,
      ),
      'clearing a save replaces the local identity and removes the cached ship',
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
        `document.querySelector('[data-action="play"]').textContent.trim() === 'Play' && document.querySelector('.ui-pilot').hidden`,
      ),
      'clearing a save returns to a fresh main menu',
    );
    await checkShipPreview();
    assert(
      c.events
        .slice(clearEvents)
        .some(
          (event) =>
            event.method === 'Network.webSocketCreated' ||
            (event.method === 'Network.requestWillBeSent' &&
              event.params.request.url.includes('/api/')),
        ),
      'the fresh main menu prepares a new pilot connection',
    );

    const preservedIdentity = await fetch(
      'http://localhost:3000/api/identity',
      {
        method: 'POST',
        body: savedToken,
      },
    );

    assert(preservedIdentity.ok, 'the cleared pilot remains on the server');
    await openMenuScreen('saves');
    assert(await check(`!document.querySelector('[data-clear]').disabled`));

    await check(
      `localStorage.setItem('playerToken', ${JSON.stringify(savedToken)})`,
    );
    await click('[data-back]');
    await c.send('Page.reload');
    await pause(1000);
    await checkShipPreview();
    assert(
      await check('window.gameFrames === 0'),
      'saved-ship preparation leaves the game loop stopped',
    );
    await capture('returning');
    await checkShipPreview();

    const { identifier: previewObserverScript } = await c.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `window.previewObservers = 0;
        const OriginalObserver = ResizeObserver;
        window.ResizeObserver = class extends OriginalObserver {
          observe(target, options) {
            if (target.matches('.ui-preview')) window.previewObservers++;
            super.observe(target, options);
          }
        };`,
      },
    );

    await c.send('Network.setBlockedURLs', { urls: ['*/api/identity'] });
    await c.send('Page.reload');
    await pause(1000);
    await checkShipPreview();
    assert.equal(
      await check('window.previewObservers'),
      1,
      'a cached menu preview creates one controller',
    );
    await c.send('Network.setBlockedURLs', { urls: [] });
    await openMenuScreen('settings');
    await click('[data-back]');
    await pause(500);
    assert.equal(
      await check('window.previewObservers'),
      1,
      'refreshing cached identity reuses its preview controller',
    );
    assert(
      await check(
        `performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/identity')).length >= 2`,
      ),
      'returning to the menu retries a failed identity refresh',
    );

    await c.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: previewObserverScript,
    });

    await check(`localStorage.removeItem('unicorn-preview')`);
    await c.send('Network.setBlockedURLs', { urls: [] });
    await c.send('Page.reload');
    await pause(1000);
    await checkShipPreview();

    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await pause(150);
    await checkShipPreview();
    await capture('menu-desktop');

    await check(`localStorage.removeItem('unicorn-preview')`);

    heldResource = /^\/api\/identity$/;

    const identityEvents = c.events.length;

    await c.send('Page.reload');
    await checkShipPreview();
    await waitFor(
      `performance.getEntriesByType('resource').some(entry => /gameplay-/.test(entry.name)) && !!localStorage.getItem('playerToken')`,
      'uncached preview and gameplay load while identity verification is pending',
    );
    const identityRequest = c.events
      .slice(identityEvents)
      .find(
        (event) =>
          event.method === 'Fetch.requestPaused' &&
          event.params.request.url.endsWith('/api/identity'),
      );

    assert(identityRequest, 'saved identity verification is still pending');
    assert.equal(await check('window.gameFrames'), 0);

    await c.send('Fetch.continueRequest', {
      requestId: identityRequest.params.requestId,
    });

    heldResource = /gameplay-.*\.js$/;

    const gameplayEvents = c.events.length;

    await c.send('Page.reload');
    await checkShipPreview();
    const gameplayRequest = c.events
      .slice(gameplayEvents)
      .find(
        (event) =>
          event.method === 'Fetch.requestPaused' &&
          /gameplay-.*\.js$/.test(event.params.request.url),
      );

    assert(gameplayRequest, 'background gameplay request is pending');
    await openMenuScreen('settings');
    await click('[data-back]');

    await c.send('Fetch.failRequest', {
      requestId: gameplayRequest.params.requestId,
      errorReason: 'Failed',
    });

    heldResource = undefined;
    assert(
      await check(`!document.querySelector('[data-action="play"]').disabled`),
      'a failed preparation leaves the menu interactive',
    );

    const { identifier: playScript } = await c.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `new MutationObserver((_, observer) => {
          const play = document.querySelector('.ui-main [data-action="play"]');
          if (!play) return;
          observer.disconnect();
          play.click();
          window.playedBeforePreview = true;
        }).observe(document, { childList: true, subtree: true });`,
      },
    );

    await c.send('Page.reload');
    await waitFor(
      `window.playedBeforePreview && !document.querySelector('.ui-main')`,
      'Play starts before the deferred menu preview',
    );

    await c.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: playScript,
    });

    assert(
      await check('!window.previewFrame'),
      'playing immediately cancels menu preview rendering',
    );

    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  if (process.env.UI_MENU_ONLY) {
    console.log(
      'Production menu: deferred preparation, connection reuse, delayed identity, failed loading, navigation and immediate Play passed.',
    );
    break checkUi;
  }

  await c.send('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: menuFrameScript,
  });

  await c.send('Page.navigate', {
    url: `http://localhost:3000/${fixturePath}/index.html`,
  });

  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );
  const graphics = await check('fixture.checkGraphics()');
  const bays = await check('fixture.checkStationBay()');
  const chat = await check('fixture.checkChat()');
  const hud = await check('fixture.checkHud()');

  for (const [behavior, passed] of Object.entries(hud)) {
    assert(passed, `HUD: ${behavior}`);
  }

  for (const [behavior, passed] of Object.entries(chat)) {
    assert(passed, `chat: ${behavior}`);
  }

  for (const renderer of ['canvas', 'webgl']) {
    await check(`localStorage.setItem('unicorn-renderer', '${renderer}')`);
    await c.send('Page.reload');
    await pause(250);
    await check(
      `(async () => { window.fixture = await import('./fixture.js'); })()`,
    );

    for (const density of [1, 1.25, 1.5, 2]) {
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: density,
        mobile: false,
      });

      const [results, cleared, legacy, world] = await check(
        'fixture.checkHudText()',
      );

      for (const [resolution, width, height, difference, visible] of results) {
        assert.equal(
          width,
          1280 * density,
          'HUD width follows display density',
        );
        assert.equal(
          height,
          900 * density,
          'HUD height follows display density',
        );
        assert(visible, 'HUD text contains visible pixels');
        assert(
          difference < 0.05,
          `${renderer}, density ${density}, world ${resolution}: cached and native text differ by ${difference}`,
        );
      }

      assert(cleared, 'switching HUD resolution clears the previous overlay');
      assert.deepEqual(
        legacy,
        world,
        'legacy HUD resolution follows the world',
      );
    }
  }

  await check(`localStorage.setItem('unicorn-renderer', 'canvas')`);

  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await c.send('Page.reload');
  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );

  bays.forEach(
    ({ rotation, difference }: { rotation: number; difference: number }) => {
      assert(
        difference <= 2,
        `Docking bay at ${rotation}: cached and direct rendering differ by ${difference}`,
      );
    },
  );

  const [initial, minor, major, damaged, resized] = await check(
    'fixture.checkStationGuideCache()',
  );

  assert.equal(initial[0], 1);
  assert.equal(minor[0], 1, 'minor rotation reuses the station guide');
  assert.notEqual(initial[1], minor[1], 'movement and rotation stay smooth');
  assert.equal(major[0], 1, 'a larger turn reuses the station guide');
  assert.equal(damaged[0], 1, 'hull damage does not repaint the station guide');
  assert.equal(resized[0], 2, 'resolution changes refresh native artwork');

  graphics.forEach(
    ({ name, difference }: { name: string; difference: number }) => {
      assert(
        difference <= 2,
        `${name}: WebGL and native canvas pixels differ by ${difference}`,
      );
    },
  );

  if (process.env.UI_GRAPHICS_ONLY) {
    console.log(
      'Production graphics: holes, clips, blending, gradients, transforms, uploads, and frame order passed.',
    );
    break checkUi;
  }

  await pause(250);

  for (const activation of ['Enter', ' ', 'click']) {
    await click('[data-tab="outfitting"]');
    await click('[data-key="mount:0"]');
    await click('[data-command="REMOVE"]');
    const candidate = '[data-candidates] [data-key="shop-laser"]';

    await click(candidate);
    assert.equal(
      await check(`document.querySelector('[data-health]').textContent`),
      '40/40',
      'a new Beam Laser previews full health',
    );
    const before = await check('fixture.transactionState()');

    if (activation === 'click') {
      await click('[data-command="BUY"]');
    } else {
      await check(`document.querySelector('[data-command="BUY"]').focus()`);
      await pressKey(activation);
    }

    const bought = await check('fixture.transactionState()');

    assert.equal(
      bought[0],
      before[0] - 700,
      'a Beam Laser purchase charges once',
    );
    assert.notEqual(
      bought[1][0],
      null,
      'buying fits the module into the selected empty slot',
    );
    assert.deepEqual(
      bought[2],
      before[2],
      'automatic fitting leaves existing cargo untouched',
    );
    assert.equal(
      await check(`document.querySelector('[data-health]').textContent`),
      '40/40',
      'a newly fitted Beam Laser has full health',
    );
    assert(
      await check(`document.activeElement.matches('[data-command="REMOVE"]')`),
      'buying an empty-slot module focuses its fitted controls',
    );
    await click('[data-command="REMOVE"]');
    await click('[data-candidates] [data-key="owned-' + bought[1][0] + '"]');
    assert.equal(
      await check(`document.querySelector('[data-health]').textContent`),
      '40/40',
      'an intact Beam Laser in cargo displays its active health',
    );
    await c.send('Page.reload');
    await pause(250);
    await check(
      `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
    );
    await pause(250);
  }

  assert(await check(`!!document.querySelector('[data-loadout]')`));
  await check(`fixture.notification('DIAMOND SOLD - CYAN UNLOCKED')`);
  assert(
    await check(`(() => {
    const note = document.querySelector('.ui-notification');
    return !note.hidden && note.textContent === 'DIAMOND SOLD - CYAN UNLOCKED' &&
      getComputedStyle(note).pointerEvents === 'none' && Number(getComputedStyle(note).zIndex) > (Number(getComputedStyle(document.querySelector('.hud')).zIndex) || 0);
  })()`),
    'notifications appear above docking without blocking pointer input',
  );
  await check(`fixture.notification('')`);
  assert(
    await check(`document.querySelector('.ui-notification').hidden`),
    'expired notifications leave no visible overlay',
  );
  assert.deepEqual(
    await check(`fixture.previewStability()`),
    [true, true, true, true],
    'preview updates retain animation for cooldown, cargo, paint and health changes while rebuilding changed loadouts',
  );

  assert(
    await check(`(() => {
    const footer = document.querySelector('.dock-footer');
    const launch = footer.querySelector('[data-launch]');
    const controls = footer.lastElementChild;
    const keys = [...controls.querySelectorAll('kbd')].map(key => key.textContent);
    return ['↑', '↓', '←', '→', 'Enter', 'Space'].every(key => keys.includes(key))
      && footer.firstElementChild === launch
      && launch.querySelector('kbd').textContent === 'Esc'
      && launch.getBoundingClientRect().right <= controls.getBoundingClientRect().left
      && controls.getBoundingClientRect().right <= footer.getBoundingClientRect().right;
  })()`),
    'the footer places Escape on the left and navigation and selection hints on the right',
  );
  await check(`document.querySelector('[data-launch]').focus()`);

  assert(
    await check(`(() => {
    const launch = document.querySelector('[data-launch]');
    const style = getComputedStyle(launch);
    const icon = launch.querySelector('.dock-launch-icon');
    return style.color === 'rgb(255, 255, 255)'
      && parseFloat(style.webkitTextStrokeWidth) === 0
      && getComputedStyle(launch.querySelector('kbd')).borderColor === 'rgb(221, 221, 221)'
      && getComputedStyle(icon).opacity === '1' && !!icon.querySelector('svg path');
  })()`),
    'the Launch action shows white text, a highlighted shortcut border, and the ship outline on keyboard focus',
  );

  for (const tab of ['overview', 'outfitting', 'trade', 'services']) {
    await click(`[data-tab="${tab}"]`);
    await pressKey('ArrowDown');
    assert(
      await check(
        `!!document.activeElement.closest('${tab === 'trade' ? '[data-trade-stock]' : '[data-sidebar]'}') && !document.activeElement.disabled`,
      ),
      `${tab}: Down enters the active tab's content`,
    );
    await pressKey('ArrowUp');
    assert(
      await check(
        `document.activeElement.getAttribute('data-tab') === '${tab}'`,
      ),
      `${tab}: Up from the first content action returns to the active tab`,
    );
    await pressKey('ArrowRight');
    await pressKey('ArrowLeft');
    assert(
      await check(
        `document.activeElement.getAttribute('data-tab') === '${tab}'`,
      ),
      'Left and Right still navigate between tabs',
    );
  }

  const focusDock = async (selector: string) => {
    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 10,
      y: 10,
    });

    await check(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  };

  const selectCandidate = async (selector: string, activation = 'Enter') => {
    const transaction = await check('fixture.transactionState()');

    await focusDock(selector);
    await pressKey(activation);
    assert.deepEqual(
      await check('fixture.transactionState()'),
      transaction,
      'selecting a compatible module does not buy, equip, or sell it',
    );
    assert(
      await check(`document.activeElement === (Array.from(document.querySelectorAll('.dock-detail button'))
        .find(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.getClientRects().length)
        || document.querySelector('.dock-detail'))
        && document.activeElement.matches(':focus-visible')`),
      'Enter and Space focus the first available action, or the card when all actions are disabled',
    );
    assert(
      await check(`(() => {
      const list = document.querySelector('[data-candidate-panel]');
      const card = document.querySelector('.dock-detail');
      return !list.hidden && !card.hidden && card.scrollTop === 0 && list.parentElement === card.parentElement
        && list.getBoundingClientRect().bottom + 24 <= card.getBoundingClientRect().top + 0.1;
    })()`),
      'selecting a compatible module reveals a separate card below the list',
    );
  };

  const expectEmptySlot = async () => {
    assert(
      await check(`document.querySelector('.dock-detail').hidden
        && !document.querySelector('[data-candidate-panel]').hidden
        && document.querySelector('[data-title]').textContent === 'Empty slot'
        && !document.querySelector('[data-candidates] [aria-pressed="true"]')`),
      'an empty slot shows a separate compatible-module list and keeps the unselected card hidden',
    );
  };

  const expectFocus = async (selector: string, message: string) => {
    assert(
      await check(
        `document.activeElement.matches(${JSON.stringify(selector)})`,
      ),
      message,
    );
  };

  const committedDockState = () =>
    check(`[
      [...document.querySelectorAll('.dock-screen [data-key][aria-pressed="true"]')].map(button => button.getAttribute('data-key')),
      document.querySelector('[data-tab][aria-current="page"]').getAttribute('data-tab'),
      document.querySelector('[data-hull-paint]').getAttribute('aria-pressed'),
      fixture.navigationState()
    ]`);

  const checkDockTabOrder = async () => {
    const committed = await committedDockState();

    for (const shift of [false, true]) {
      await focusDock('[data-tab="overview"]');
      let visited = 0;

      do {
        await check(`(() => {
          const buttons = [...document.querySelectorAll('.dock-screen button:not(:disabled)')].filter(button => button.getClientRects().length);
          const index = buttons.indexOf(document.activeElement);
          window.nextDockFocus = buttons.at((index + ${shift ? -1 : 1}) % buttons.length);
        })()`);
        await pressKey('Tab', { shift });
        assert(
          await check(`document.activeElement === nextDockFocus`),
          `${shift ? 'Shift+Tab' : 'Tab'} follows visible, enabled controls and wraps inside the station`,
        );
        assert.deepEqual(
          await committedDockState(),
          committed,
          'Tab and Shift+Tab preserve committed selection, the active section, and transactions',
        );

        assert(++visited < 100, 'Tab navigation completes a cycle');
      } while (
        !(await check(
          `document.activeElement.matches('[data-tab="overview"]')`,
        ))
      );
    }
  };

  await click('[data-tab="outfitting"]');
  await focusDock('[data-tab="outfitting"]');
  await check('fixture.watchDockActivity()');
  const dockActivity = () => check('fixture.dockActivityState()');
  const activitySelection = await committedDockState();
  let activity = (await dockActivity())[0];

  await pressKey('ArrowDown');
  assert(
    (await dockActivity())[0] > activity,
    'keyboard navigation handled by the docked UI reports player activity',
  );
  assert.deepEqual(await committedDockState(), activitySelection);
  activity = (await dockActivity())[0];
  await hover('[data-outfitting] h2');
  assert(
    (await dockActivity())[0] > activity,
    'docked pointer movement reports activity',
  );
  activity = (await dockActivity())[0];
  await click('[data-tab="outfitting"]');
  assert((await dockActivity())[0] > activity, 'docked clicks report activity');
  activity = (await dockActivity())[0];
  const [wheelX, wheelY] = await check(`(() => {
    const box = document.querySelector('[data-sidebar]').getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2];
  })()`);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: wheelX,
    y: wheelY,
    deltaX: 0,
    deltaY: 100,
  });

  await waitFor(
    `fixture.dockActivityState()[0] > ${activity}`,
    'docked scrolling reports activity',
  );
  assert.equal(
    (await dockActivity())[1],
    0,
    'docked activity preserves neutral flight controls',
  );
  activity = (await dockActivity())[0];
  await check(`fixture.refresh();
    document.querySelector('[data-loadout]').dispatchEvent(new Event('scroll', { bubbles: true }))`);
  assert.equal(
    (await dockActivity())[0],
    activity,
    'passive dock updates do not report activity',
  );
  await check('fixture.stopDockActivity()');

  await check('fixture.tradeCargo()');
  await click('[data-tab="trade"]');
  const browsingTrade = await committedDockState();

  await pressKey('ArrowDown');
  await expectFocus('[data-trade-items] button', 'Down focuses the Sell list');
  await pressKey('ArrowRight');
  await expectFocus('[data-stock-items] button', 'Right focuses the Buy list');
  assert.deepEqual(
    await committedDockState(),
    browsingTrade,
    'Down then Right browses Trade without selecting an item',
  );

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 10,
    y: 10,
  });

  await check('document.activeElement.blur()');
  assert(
    await check(
      `Array.from(document.querySelectorAll('.dock-trade-price, .dock-trade-supply')).every(label => getComputedStyle(label).visibility === 'visible' && getComputedStyle(label, '::before').content === 'none')`,
    ),
    'idle trade rows show plain prices and supply counts',
  );
  assert(
    await check(`Array.from(document.querySelectorAll('.dock-trade-heading, .dock-trade-row')).every(row => {
      const bounds = Array.from(row.children).slice(-2).map(cell => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getBoundingClientRect();
      });
      return bounds[1].left - bounds[0].right >= 10 - 0.1;
    })`),
    'trade quantities, prices, and their headings have room between columns',
  );
  assert(
    await check(`Array.from(document.querySelectorAll('.dock-trade-row')).every(row => {
      const bounds = row.getBoundingClientRect();
      const center = (bounds.top + bounds.bottom) / 2;
      return Array.from(row.querySelectorAll('.dock-row-text')).every(text => {
        const cell = text.getBoundingClientRect();
        return Math.abs((cell.top + cell.bottom) / 2 - center) < 3;
      });
    })`),
    'trade names, supply counts, and prices stay vertically centered in their row',
  );
  assert(
    await check(`Array.from(document.querySelectorAll('.dock-trade-row')).every(row => {
      const cells = Array.from(row.children);
      return cells.slice(1).every((cell, index) => {
        const previous = cells[index];
        return Math.abs(previous.getBoundingClientRect().right - cell.getBoundingClientRect().left) < 0.1
          && getComputedStyle(previous).borderRightWidth === '1px'
          && getComputedStyle(cell).borderLeftWidth === '1px';
      });
    })`),
    'adjacent trade cells join their 1px borders into 2px dividers',
  );
  assert(
    await check(
      `Array.from(document.querySelectorAll('.dock-trade-name')).every(name => getComputedStyle(name, '::after').content === 'none')`,
    ),
    'idle item names hide their trade action',
  );

  for (const selector of [
    '[data-trade-items] [data-key]',
    '[data-stock-items] [data-key]',
  ]) {
    const action = selector.startsWith('[data-trade-items]') ? 'SELL' : 'BUY';

    await hover(selector);
    assert.equal(
      await check(
        `getComputedStyle(document.querySelector('${selector} .dock-trade-name'), '::after').content`,
      ),
      `"${action}"`,
      'hovering appends the column action to the item name',
    );
    assert(
      await check(
        `getComputedStyle(document.querySelector('${selector} .dock-trade-price')).visibility === 'visible'`,
      ),
      'hovering an item keeps its price visible',
    );
    await hover(selector + ' .dock-trade-price');
    assert.deepEqual(
      await committedDockState(),
      browsingTrade,
      'hovering a price preserves ownership and selection',
    );
    await focusDock(selector);
    assert.equal(
      await check(
        `getComputedStyle(document.querySelector('${selector} .dock-trade-name'), '::after').content`,
      ),
      `"${action}"`,
      'focusing appends the column action to the item name',
    );
    assert(
      await check(
        `getComputedStyle(document.querySelector('${selector} .dock-trade-price')).visibility === 'visible'`,
      ),
      'focusing an item keeps its price visible',
    );
  }

  for (const selector of [
    '.dock-detail',
    '[data-tab="overview"]',
    '[data-stock-items] button',
    '[data-trade-items] button',
    '[data-description]',
    '[data-launch]',
  ]) {
    await hover(selector);
    assert.deepEqual(
      await committedDockState(),
      browsingTrade,
      'hovering rows, actions, sections, and the footer preserves selection and transactions',
    );
    assert.equal(
      await check(`document.querySelector('[data-back-label]').textContent`),
      'Launch',
      'hovering a Trade card does not enter its detail navigation state',
    );
  }

  await focusDock('[data-trade-items] button');

  for (const key of [
    'ArrowRight',
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'Tab',
  ]) {
    await pressKey(key);
    assert.deepEqual(
      await committedDockState(),
      browsingTrade,
      `${key} moves focus without committing a Trade selection`,
    );
  }

  await checkDockTabOrder();

  await check('fixture.beamLaser()');
  await click('[data-stock-items] [data-key="shop:item-5"]');
  assert.deepEqual(
    await check(`Array.from(document.querySelectorAll('[data-trade-items] [data-trade-group]'), group => [
      group.getAttribute('data-trade-group'),
      Array.from(group.querySelectorAll('.dock-trade-name'), name => name.textContent),
    ])`),
    [
      ['items', ['Diamond']],
      ['modules', ['Beam Laser']],
      ['ammunition', ['Autogun Ammo']],
    ],
    'cargo tables classify items, modules, and ammunition without duplicates',
  );
  await capture('docked-cargo-groups');
  await focusDock(
    '[data-trade-items] [data-trade-group="items"] button:last-child',
  );
  await pressKey('ArrowDown');
  await expectFocus(
    '[data-trade-items] [data-trade-group="modules"] button',
    'Down crosses from items into modules',
  );
  await pressKey('ArrowDown');
  await expectFocus(
    '[data-trade-items] [data-trade-group="ammunition"] button',
    'Down crosses from modules into ammunition',
  );
  await pressKey('ArrowUp');
  await expectFocus(
    '[data-trade-items] [data-trade-group="modules"] button',
    'Up crosses back into modules',
  );
  await pressKey('ArrowDown');
  await pressKey('Enter');
  assert(
    await check(
      `!document.querySelector('[data-trade-items] [data-trade-group="ammunition"]')`,
    ),
    'selling the last ammunition hides its empty table',
  );
  await expectFocus(
    '[data-trade-items] [data-trade-group="modules"] button',
    'removing a cargo table restores focus to remaining cargo',
  );
  await pressKey('Enter');
  assert(
    await check(
      `!document.querySelector('[data-trade-items] [data-trade-group="modules"]')`,
    ),
    'selling the last module hides its empty table',
  );
  await expectFocus(
    '[data-trade-items] [data-trade-group="items"] button',
    'focus stays in cargo after the module table disappears',
  );
  await pressKey('Enter');
  await expectFocus(
    '[data-tab="trade"]',
    'selling the final cargo group returns focus to the Trade tab',
  );
  assert(
    await check(
      `!document.querySelector('[data-trade-items] [data-trade-group]') && document.querySelector('[data-trade-items]').textContent.includes('No cargo to sell.')`,
    ),
    'empty cargo shows a message without empty table headings',
  );

  for (const activation of ['Enter', ' ', 'click']) {
    await c.send('Page.reload');
    await pause(250);
    await check(
      `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
    );
    await pause(250);
    await check(
      'fixture.setFuel(120, 10000); fixture.tradeCargo(); fixture.tradeCargo()',
    );
    await click('[data-tab="trade"]');

    const activateTradeRow = async (selector: string) => {
      if (activation === 'click') {
        await check('document.activeElement.blur()');
        await click(selector);
      } else {
        await focusDock(selector);
        await pressKey(activation);
      }
    };

    const checkTradeActionVisibility = async (
      selector: string,
      action: string,
    ) => {
      if (activation === 'click') {
        const hoverBorder = await check(
          `getComputedStyle(document.querySelector('${selector}')).borderTopColor`,
        );

        await c.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 10,
          y: 10,
        });

        assert.deepEqual(
          await check(`(() => {
            const row = document.querySelector('${selector}');
            return [document.activeElement === row, row.matches(':focus-visible'), row.matches(':hover'),
              getComputedStyle(row.querySelector('.dock-trade-name'), '::after').content];
          })()`),
          [true, false, false, 'none'],
          `mouse-focused ${action} rows hide their action after the pointer leaves`,
        );
        assert.notEqual(
          await check(
            `getComputedStyle(document.querySelector('${selector}')).borderTopColor`,
          ),
          hoverBorder,
          'mouse focus keeps the idle border after the pointer leaves',
        );
        await hover(selector);
      } else {
        assert(
          await check(
            `document.querySelector('${selector}').matches(':focus-visible')`,
          ),
          'keyboard trade activation retains visible focus',
        );
      }

      assert.equal(
        await check(
          `getComputedStyle(document.querySelector('${selector} .dock-trade-name'), '::after').content`,
        ),
        `"${action}"`,
        'hover and visible keyboard focus show the trade action',
      );
    };

    const ammoStock = '[data-stock-items] [data-key="shop:item-5"]';

    for (let purchase = 0; purchase < 2; purchase++) {
      const before = await check('fixture.transactionState()');

      await activateTradeRow(ammoStock);
      const after = await check('fixture.transactionState()');

      assert.equal(
        after[2].length,
        before[2].length + 1,
        `${activation} buys one ammunition bundle per activation`,
      );
      assert.equal(after[3].length, before[3].length - 1);
      await checkTradeActionVisibility(ammoStock, 'BUY');
      assert(
        await check(
          `document.querySelector('[data-title]').textContent === 'Autogun Ammo' && document.querySelector('[data-description]').textContent.includes('Autogun ammunition')`,
        ),
        'buying from a surviving stack retains its inspector and full ammunition description',
      );
    }

    for (const resource of [0, 5]) {
      const row = `[data-trade-items] [data-key="cargo:item-${resource}"]`;

      await focusDock(row);
      const price = await check(
        `document.querySelector('${row} .dock-trade-price').textContent`,
      );

      assert.equal(
        await check(`document.querySelector('[data-trade-value]').textContent`),
        price,
        'the inspector shows the price of one item',
      );
      assert.equal(
        await check(
          `document.querySelector('[data-trade-price-label]').textContent`,
        ),
        'Sell price',
      );
      assert(
        await check(
          `document.querySelector('${row}').getAttribute('aria-label').startsWith('Sell one ')`,
        ),
        'the accessible sale label describes one item',
      );

      for (let remaining = 1; remaining >= 0; remaining--) {
        const before = await check('fixture.transactionState()');

        await activateTradeRow(row);
        const after = await check('fixture.transactionState()');

        assert.equal(
          after[2].length,
          before[2].length - 1,
          `${activation} sells one cargo item per activation`,
        );
        assert.equal(after[3].length, before[3].length + 1);
        assert.equal(
          after[0] - before[0],
          Number(price.slice(0, -1).replaceAll(',', '')),
        );

        if (remaining) {
          assert.equal(
            await check(
              `document.querySelector('${row} .dock-trade-supply').textContent`,
            ),
            String(remaining),
          );
          await expectFocus(row, 'selling from a stack keeps its row focused');
          await checkTradeActionVisibility(row, 'SELL');
        } else {
          assert(
            await check(`!document.querySelector('${row}')`),
            'selling the last item removes its row',
          );
        }
      }
    }

    await c.send('Page.reload');
    await pause(250);
    await check(
      `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
    );
    await pause(250);
    await check(
      'fixture.setFuel(120, 10000); fixture.beamLaser(); fixture.beamLaser()',
    );
    const stockIds = await check('fixture.moduleStock()');

    await click('[data-tab="trade"]');
    assert.deepEqual(
      await check(`Array.from(document.querySelectorAll('[data-stock-items] [data-trade-group]'), group => [
        group.getAttribute('data-trade-group'),
        Array.from(group.querySelectorAll('.dock-trade-name'), name => name.textContent),
      ])`),
      [
        ['modules', ['Beam Laser', 'Beam Laser']],
        ['ammunition', ['Autogun Ammo']],
      ],
      'station stock separates modules and ammunition into matching trade tables',
    );
    const beforeTrade = await committedDockState();
    const firstStock = `[data-stock-items] [data-key="shop:module-${stockIds[0]}"]`;
    const secondStock = `[data-stock-items] [data-key="shop:module-${stockIds[1]}"]`;

    await focusDock(firstStock);
    await pressKey('ArrowDown');
    await expectFocus(secondStock, 'Down focuses the next stock item');

    if (activation === 'Enter') {
      await hover(firstStock);
      const stockHighlights = () =>
        check(`['${firstStock}', '${secondStock}'].map(selector => {
          const row = document.querySelector(selector);
          return [getComputedStyle(row).outlineStyle,
            getComputedStyle(row.querySelector('.dock-trade-name'), '::after').content];
        })`);

      assert.deepEqual(
        await stockHighlights(),
        [
          ['solid', '"BUY"'],
          ['none', 'none'],
        ],
        'pointer hover hides the separate keyboard outline and trade action',
      );
      await pressKey('ArrowRight');
      await expectFocus(
        secondStock,
        'hover preserves the keyboard navigation position',
      );
      assert.deepEqual(
        await stockHighlights(),
        [
          ['none', 'none'],
          ['solid', '"BUY"'],
        ],
        'an arrow key hides the stationary hover outline and trade action even when focus stays put',
      );
    }

    await pressKey('ArrowUp');
    await expectFocus(firstStock, 'Up returns to the previous stock item');
    await pressKey('ArrowLeft');
    await expectFocus(
      '[data-trade-items] [data-key]',
      'Left focuses cargo directly',
    );
    await pressKey('ArrowRight');
    await expectFocus(firstStock, 'Right returns directly to station stock');
    await pressKey('ArrowDown');
    await pressKey('ArrowRight');
    await expectFocus(
      secondStock,
      'Right at the final item column keeps focus on its row',
    );
    assert.deepEqual(
      await committedDockState(),
      beforeTrade,
      'arrow navigation only inspects items',
    );
    const beforePurchase = await check('fixture.transactionState()');

    await check('fixture.replaceTradeCargo()');

    if (activation === 'click') {
      await click(secondStock + ' .dock-trade-price');
    } else {
      await pressKey(activation);
    }

    const purchased = await check('fixture.transactionState()');

    assert(
      purchased[2].includes(stockIds[1]) &&
        !purchased[3].includes(stockIds[1]) &&
        purchased[3].includes(stockIds[0]),
      `${activation} buys exactly the activated row's module instance`,
    );
    assert.equal(purchased[2].length, beforePurchase[2].length + 1);
    assert(purchased[0] < beforePurchase[0]);
    assert(
      await check(`!!document.activeElement.closest('[data-stock-items]')`),
      'a completed purchase keeps focus in station stock',
    );
    const soldRow = `[data-trade-items] [data-key="cargo:module-${stockIds[1]}"]`;

    await focusDock(soldRow);
    await check('fixture.replaceTradeCargo()');

    if (activation === 'click') {
      await click(soldRow + ' .dock-trade-price');
    } else {
      await pressKey(activation);
    }

    const sold = await check('fixture.transactionState()');

    assert.deepEqual(
      sold.slice(0, 3),
      beforePurchase.slice(0, 3),
      `${activation} sells exactly the activated row's module and restores ownership and balance`,
    );
    assert.equal(sold[3].length, beforePurchase[3].length);
    assert(
      sold[3].includes(stockIds[0]),
      'selling preserves the other stock instance',
    );
    assert(
      await check(`!!document.activeElement.closest('[data-trade-items]')`),
      'a completed sale keeps focus in remaining cargo',
    );

    await check('fixture.setFuel(120, 0)');
    await focusDock(firstStock);
    assert(
      await check(
        `document.querySelector('${firstStock}').getAttribute('aria-disabled') === 'true'`,
      ),
      'unaffordable rows remain focusable and marked unavailable',
    );
    const unaffordable = await check('fixture.transactionState()');

    await pressKey('Enter');
    await pressKey(' ');
    await click(firstStock);
    await expectFocus(
      firstStock,
      'unavailable rows remain focusable for inspection',
    );
    assert.deepEqual(
      await check('fixture.transactionState()'),
      unaffordable,
      'unavailable row activation cannot spend credits or transfer cargo',
    );
    await check('fixture.setFuel(120, 10000); fixture.fillCargo()');
    assert(
      await check(
        `Array.from(document.querySelectorAll('[data-stock-items] [data-key]')).every(button => button.getAttribute('aria-disabled') === 'true')`,
      ),
      'full cargo blocks every stock row purchase',
    );
    const fullCargo = await check('fixture.transactionState()');

    await pressKey('Enter');
    await pressKey(' ');
    await click(firstStock);
    assert.deepEqual(await check('fixture.transactionState()'), fullCargo);
  }

  await c.send('Page.reload');
  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );
  await pause(250);

  for (const activation of ['Enter', ' ']) {
    for (const tab of ['overview', 'outfitting', 'trade', 'services']) {
      await focusDock(`[data-tab="${tab}"]`);
      await pressKey(activation);
      assert(
        await check(
          `document.querySelector('[data-tab="${tab}"]').hasAttribute('aria-current')`,
        ),
        `${activation} activates the ${tab} tab`,
      );
      await checkDockTabOrder();
      await focusDock(`[data-tab="${tab}"]`);
      await pressKey('ArrowUp');
      await expectFocus(
        `[data-tab="${tab}"]`,
        'Up at the top does not move sideways through tabs',
      );
    }

    await focusDock('[data-tab="overview"]');
    await pressKey(activation);
    await focusDock('[data-tab="outfitting"]');
    await pressKey(activation);
    await expectFocus(
      '[data-tab="outfitting"]',
      'activating Outfitting leaves focus on its tab',
    );
    await pressKey('ArrowDown');
    await expectFocus(
      '[data-key="hull:0"]',
      'Down enters the loadout from the Outfitting tab',
    );

    for (const key of ['hull:0', 'mount:0', 'mount:2']) {
      await focusDock(`[data-loadout] [data-key="${key}"]`);

      for (const arrow of ['ArrowLeft', 'ArrowRight']) {
        await pressKey(arrow);
        await expectFocus(
          `[data-key="${key}"]`,
          'horizontal arrows do not move through loadout rows',
        );
      }

      await pressKey(activation);
      assert(
        await check(`!!document.activeElement.closest('.dock-inspector')`),
        `${activation} opens details or the compatible-module list for an empty slot`,
      );

      if (key === 'mount:2') {
        assert(
          await check(
            `!document.querySelector('[data-candidates] [aria-pressed="true"]')`,
          ),
          'opening an empty slot leaves all compatible modules unselected',
        );
      }

      if (key !== 'hull:0') {
        await check(`window.detailControl = document.activeElement`);
        await pressKey('ArrowRight');
        await pressKey('ArrowLeft');
        assert(
          await check(`document.activeElement === detailControl`),
          'horizontal arrows leave actions and compatible-module rows in place',
        );
        await checkDockTabOrder();
      } else {
        await pressKey('Tab');
        await expectFocus(
          '[data-launch]',
          'Tab from a detail card with no enabled actions reaches the footer',
        );
      }

      await pressKey('Escape');
      await expectFocus(
        `[data-key="${key}"]`,
        'Escape restores the original loadout row after keyboard navigation',
      );
      await pressKey('Escape', { repeat: true });
      assert(
        await check(`!fixture.inspect()[3]`),
        'holding Escape after closing details does not launch',
      );
    }

    await focusDock('[data-loadout] [data-key="mount:0"]');
    await pressKey(activation);
    await check(
      `document.querySelector('[data-loadout]').lastElementChild.lastElementChild.focus()`,
    );
    await check('window.lastLoadoutFocus = document.activeElement');
    await pressKey('ArrowDown');
    await expectFocus(
      '[data-launch]',
      'Down from the final loadout row reaches the footer',
    );
    await pressKey('ArrowUp');
    assert(
      await check('document.activeElement === lastLoadoutFocus'),
      'Up from the footer returns to the same loadout row even with details open',
    );
    await pressKey('Escape');

    await focusDock('[data-tab="services"]');
    await pressKey(activation);
    await focusDock('[data-service="paint"]');
    await pressKey(activation);
    await expectFocus(
      '[data-paint]',
      'opening Hull Paint focuses an unlocked swatch',
    );
    assert(
      await check(
        `document.querySelector('[data-tab="services"]').hasAttribute('aria-current')`,
      ),
      'Hull Paint preserves the Services tab',
    );
    await check(`window.firstPaint = document.activeElement`);
    await pressKey('ArrowRight');
    assert(
      await check(
        `document.activeElement !== firstPaint && document.activeElement.matches('[data-paint]:not(:disabled)')`,
      ),
      'Right moves to the next unlocked paint',
    );
    await pressKey('ArrowLeft');
    assert(
      await check(`document.activeElement === firstPaint`),
      'Left returns to the previous unlocked paint',
    );
    await pressKey(activation);
    assert(
      await check(
        `document.activeElement.getAttribute('aria-pressed') === 'true'`,
      ),
      'Enter and Space apply the focused paint',
    );
    await checkDockTabOrder();
    await pressKey('Escape');
    await expectFocus(
      '[data-service="paint"]',
      'Escape returns to the Services paint button',
    );

    await click('[data-tab="overview"]');
    await focusDock('[data-hull-paint]');
    await pressKey(activation);
    await pressKey('Escape');
    await expectFocus(
      '[data-hull-paint]',
      'Escape returns to the overview paint button',
    );
  }

  await check(`fixture.damageHull()`);
  await click('[data-tab="services"]');
  await focusDock('[data-service="repair"]');
  await pressKey('Enter');
  await expectFocus(
    '[data-service="paint"]',
    'repairing from Services skips the newly disabled Repair All button',
  );
  await check(`fixture.damageHull()`);
  await click('[data-tab="overview"]');
  await focusDock('[data-repair-all]');
  await pressKey(' ');
  await expectFocus(
    '[data-hull-paint]',
    'repairing from the overview preserves focus on an enabled action',
  );

  await focusDock('[data-tab="trade"]');
  await pressKey('Enter');
  await focusDock('[data-stock-items] > section:last-child button:last-child');
  await pressKey('Tab');
  await expectFocus(
    '[data-launch]',
    'Tab from stock skips the informational card and reaches Launch',
  );
  await pressKey('Tab', { shift: true });
  await expectFocus(
    '[data-stock-items] > section:last-child button:last-child',
    'Shift+Tab returns from Launch to the final stock row',
  );

  await check('fixture.tradeCargo()');
  await focusDock('[data-trade-items] button:last-child');
  await pressKey(' ');
  await expectFocus(
    '[data-tab="trade"]',
    'selling the last cargo row restores focus to the active tab',
  );
  assert(
    await check(
      `document.querySelector('[data-back-label]').textContent === 'Launch'`,
    ),
    'selling the last cargo closes its detail navigation state',
  );
  await focusDock('[data-stock-items] > section:last-child button:last-child');
  await pressKey('Tab');
  await expectFocus('[data-launch]', 'Trade cards have no extra focus stops');
  await pressKey('Tab', { shift: true });
  await expectFocus(
    '[data-stock-items] > section:last-child button:last-child',
    'returning from the footer preserves the current stock row',
  );
  await focusDock('[data-stock-items] [data-key="shop:item-0"]');
  await pressKey('Enter');
  await expectFocus(
    '[data-stock-items] button',
    'buying an entire stock row restores focus to remaining stock',
  );

  await check('document.activeElement.blur()');
  await pressKey('ArrowDown');
  await expectFocus(
    '[data-tab="trade"]',
    'arrow navigation without focus starts from the active station tab',
  );
  await check('document.activeElement.blur()');
  await pressKey('Tab', { shift: true });
  await expectFocus(
    '[data-launch]',
    'Shift+Tab without focus starts at the station footer',
  );

  await focusDock('[data-tab="outfitting"]');
  await pressKey('Enter');
  await focusDock('[data-key="mount:0"]');
  await pressKey('Enter');
  await check('fixture.damage()');
  await focusDock('[data-command="FIX"]');
  await pressKey(' ');
  await expectFocus(
    '[data-command="REMOVE"]',
    'repairing a module moves focus off its disabled Repair action',
  );
  const fittedKeyboardState = await check('fixture.inspect()');

  await pressKey('Enter', { repeat: true });
  assert.deepEqual(
    await check('fixture.inspect()'),
    fittedKeyboardState,
    'repeated Enter does not activate Remove',
  );
  await pressKey('Enter');
  await expectFocus(
    '[data-candidates]',
    'Remove returns focus to the compatible-module list with no card selected',
  );
  await expectEmptySlot();
  assert(
    await check(`document.querySelector('[data-fitting-preview]').hidden`),
  );
  const emptySlotState = await committedDockState();
  const candidateKeys = await check(`[
    ...document.querySelectorAll('[data-candidates] [data-key]')
  ].map(button => button.getAttribute('data-key'))`);

  await check('fixture.watchDockPreview()');

  const fittingState = () => {
    assert.equal(errors().length, 0, errors().join('\n'));
    return check('fixture.fittingPreviewState()');
  };

  const waitForFitting = async (condition: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(errors().length, 0, errors().join('\n'));

      if (
        await check(`(() => {
        const [module, active, progress] = fixture.fittingPreviewState();
        return ${condition};
      })()`)
      ) {
        return;
      }

      await pause(50);
    }

    assert.fail(`fitting preview did not settle: ${condition}`);
  };

  const firstCandidate = `[data-candidates] [data-key="${candidateKeys[0]}"]`;
  const secondCandidate = `[data-candidates] [data-key="${candidateKeys[1]}"]`;

  await hover(firstCandidate);
  await waitForFitting('active && progress === 1');
  const firstFitting = await fittingState();

  await hover(`${firstCandidate} span:last-of-type`);
  assert.deepEqual(
    await fittingState(),
    firstFitting,
    'moving between children within a compatible row keeps it active',
  );
  await hover('[data-candidate-panel] h2');
  const leavingRow = await fittingState();

  assert.equal(leavingRow[0], firstFitting[0]);
  assert.equal(
    leavingRow[1],
    false,
    'leaving an individual compatible row deactivates it inside the same panel',
  );
  assert(leavingRow[2] > 0, 'the outgoing fitting remains while it retracts');
  await waitForFitting('module === null');
  assert.deepEqual(await committedDockState(), emptySlotState);
  await expectEmptySlot();

  await hover(firstCandidate);
  await waitForFitting('active && progress === 1');

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 10,
    y: 10,
  });

  const leavingPanel = await fittingState();

  assert.equal(leavingPanel[0], firstFitting[0]);
  assert.equal(leavingPanel[1], false);
  assert(
    leavingPanel[2] > 0,
    'leaving the panel also retracts the fitting instead of removing it instantly',
  );
  await waitForFitting('module === null');

  await focusDock(firstCandidate);
  await waitForFitting('active && progress === 1');
  await focusDock('[data-candidates]');
  const leavingFocus = await fittingState();

  assert.equal(leavingFocus[0], firstFitting[0]);
  assert.equal(leavingFocus[1], false);
  assert(leavingFocus[2] > 0, 'moving focus off a row plays retraction');
  await waitForFitting('module === null');

  await hover(firstCandidate);
  await waitForFitting('active && progress === 1');
  await hover(secondCandidate);
  const switchingFitting = await fittingState();

  assert.equal(switchingFitting[0], firstFitting[0]);
  assert.equal(switchingFitting[1], false);
  assert(
    switchingFitting[2] > 0,
    'switching compatible rows retracts the outgoing module before replacing it',
  );
  await waitForFitting('active && progress === 1');
  assert.notEqual((await fittingState())[0], firstFitting[0]);
  assert.deepEqual(await committedDockState(), emptySlotState);

  for (const key of candidateKeys) {
    await hover(`[data-candidates] [data-key="${key}"]`);
    assert.deepEqual(
      await committedDockState(),
      emptySlotState,
      'hovering compatible modules preserves the empty-slot selection',
    );
    await expectEmptySlot();
    await focusDock(`[data-candidates] [data-key="${key}"]`);

    for (const arrow of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      await pressKey(arrow);
      assert.deepEqual(
        await committedDockState(),
        emptySlotState,
        'arrow navigation previews compatible modules without selecting them',
      );
      await expectEmptySlot();
    }
  }

  await checkDockTabOrder();
  await focusDock(`[data-candidates] [data-key="${candidateKeys[0]}"]`);
  await check('fixture.damageHull()');
  await expectFocus(
    `[data-candidates] [data-key="${candidateKeys[0]}"]`,
    'replicated hull changes preserve focus without selecting a candidate',
  );
  await selectCandidate(
    `[data-candidates] [data-key="${candidateKeys[0]}"]`,
    ' ',
  );
  const activatedCandidate = await committedDockState();
  const activatedTitle = await check(
    `document.querySelector('[data-title]').textContent`,
  );

  await click(firstCandidate);
  await expectFocus(
    firstCandidate,
    'clicking a compatible module keeps focus on its row',
  );
  assert(
    await check(`!document.activeElement.matches(':focus-visible')`),
    'clicking a compatible module does not show keyboard focus',
  );
  await waitForFitting('active && progress === 1');
  await hover('[data-title]');
  await waitForFitting('active && progress === 1');
  const leavingSelectedRow = await fittingState();

  assert.equal(leavingSelectedRow[0], firstFitting[0]);
  assert.equal(
    leavingSelectedRow[1],
    true,
    'leaving a mouse-focused row keeps the selected fitting active',
  );
  assert(
    await check(
      `document.activeElement === document.querySelector(${JSON.stringify(firstCandidate)})`,
    ),
    'hovering card content does not blur its focused row',
  );
  await focusDock('.dock-detail');
  await waitForFitting('active && progress === 1');
  assert.equal(
    (await fittingState())[0],
    firstFitting[0],
    'the explicitly selected fitting stays active when focus moves to its card',
  );
  assert.deepEqual(await committedDockState(), activatedCandidate);

  await hover(secondCandidate);
  await waitForFitting('active && progress === 1');
  assert.notEqual(
    (await fittingState())[0],
    firstFitting[0],
    'hovering another candidate temporarily previews it over the selected fitting',
  );
  await hover('[data-title]');
  await waitForFitting('active && progress === 1');
  assert.equal(
    (await fittingState())[0],
    firstFitting[0],
    'leaving another candidate restores the active selected fitting',
  );
  assert.deepEqual(await committedDockState(), activatedCandidate);

  for (const key of candidateKeys) {
    await hover(`[data-candidates] [data-key="${key}"]`);
    await focusDock(`[data-candidates] [data-key="${key}"]`);
    assert.deepEqual(await committedDockState(), activatedCandidate);
    assert.equal(
      await check(`document.querySelector('[data-title]').textContent`),
      activatedTitle,
      'browsing other candidates keeps details on the explicitly selected module',
    );
  }

  await focusDock('[data-candidates] button:last-child');
  await pressKey('ArrowDown');
  await expectFocus(
    '[data-command="SELL"]',
    'Down from the last compatible module reaches the selected card actions',
  );
  await waitForFitting('active && progress === 1');
  assert.equal(
    (await fittingState())[1],
    true,
    'moving focus to the selected card restores its active fitting preview',
  );
  assert.deepEqual(await committedDockState(), activatedCandidate);
  await pressKey('ArrowUp');
  await expectFocus(
    '[data-candidates] button:last-child',
    'Up from the first card action returns to the compatible-module list',
  );
  assert.deepEqual(await committedDockState(), activatedCandidate);

  assert(
    await check(`(() => {
      const card = document.querySelector('.dock-detail');
      card.scrollTop = card.scrollHeight;
      return card.scrollTop > 0;
    })()`),
    'the selected module card can scroll independently below the list',
  );
  await selectCandidate(`[data-candidates] [data-key="${candidateKeys[1]}"]`);
  await selectCandidate(`[data-candidates] [data-key="${candidateKeys[0]}"]`);
  assert.deepEqual(await committedDockState(), activatedCandidate);

  await focusDock('[data-command="EQUIP"]');
  await pressKey(' ');
  await expectFocus(
    '[data-command="REMOVE"]',
    'equipping a candidate restores an enabled module action',
  );
  assert.deepEqual(
    await check('fixture.inspect()'),
    fittedKeyboardState,
    'Space on Equip fits the selected owned module',
  );
  await pressKey('Escape');
  await expectFocus(
    '[data-key="mount:0"]',
    'Escape after refitting returns to its loadout row',
  );
  await focusDock('[data-key="hull:0"]');
  await pressKey('Enter');
  await expectFocus('[data-command="FIX"]', 'a damaged hull focuses Repair');
  await pressKey('Enter');
  await expectFocus(
    '[data-key="hull:0"]',
    'repairing the hull returns to its row when no detail actions remain',
  );
  await pressKey('Escape');

  await click('[data-tab="overview"]');
  await focusDock('[data-hull-paint]');
  await pressKey('ArrowUp');
  await expectFocus(
    '[data-tab="overview"]',
    'Up skips disabled Refuel and Repair All and reaches Overview',
  );
  await focusDock('[data-hull-paint]');
  await check('fixture.damageHull()');
  await pressKey('ArrowUp');
  await expectFocus(
    '[data-repair-all]',
    'Up reaches Repair All when it becomes available',
  );
  await pressKey('ArrowDown');
  await expectFocus('[data-hull-paint]', 'Down returns to Hull Paint');
  await pressKey('Enter');
  await pressKey('ArrowDown');
  await expectFocus('[data-launch]', 'Down from the paint row reaches Back');
  await pressKey('ArrowUp');
  await expectFocus('[data-paint]', 'Up from Back returns to the paint row');
  await focusDock('[data-launch]');
  await pressKey(' ');
  await expectFocus(
    '[data-hull-paint]',
    'Space on Back closes details and restores the opener',
  );
  assert(
    await check('!fixture.inspect()[3]'),
    'Back does not launch while a detail panel is open',
  );

  await click('[data-tab="outfitting"]');
  await focusDock('[data-key="mount:5"]');
  await check(
    `window.hoverBox = document.activeElement.getBoundingClientRect().toJSON()`,
  );
  const hoverBox = await check('hoverBox');

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: hoverBox.x + hoverBox.width / 2,
    y: hoverBox.y + hoverBox.height / 2,
  });

  await check(`document.querySelector('[data-key="hull:0"]').focus()`);
  await pause(100);
  await expectFocus(
    '[data-key="hull:0"]',
    'scrolling keyboard focus does not hand control to a stationary mouse',
  );
  await pressKey('ArrowDown');
  await expectFocus(
    '[data-key="hull:1"]',
    'arrow navigation continues after scrolling beneath the pointer',
  );

  await check('fixture.setFuel(120, 0)');
  await focusDock('[data-tab="trade"]');
  await pressKey('Enter');
  await focusDock('[data-stock-items] > section:last-child button:last-child');
  const unavailableTrade = await committedDockState();

  await pressKey('Enter');
  await pressKey(' ');
  await expectFocus(
    '[data-stock-items] > section:last-child button:last-child',
    'unaffordable item activation keeps its row focused',
  );
  assert.deepEqual(
    await committedDockState(),
    unavailableTrade,
    'unaffordable activation preserves cargo and credits',
  );

  for (const activation of ['Enter', ' ']) {
    await c.send('Page.reload');
    await pause(250);
    await check(
      `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
    );
    await pause(250);
    await focusDock('[data-tab="outfitting"]');
    await pressKey('Enter');
    const initialTransaction = await check('fixture.transactionState()');

    await focusDock('[data-key="mount:0"]');
    await pressKey('Enter');
    await focusDock('[data-command="REMOVE"]');
    await pressKey(activation);
    await expectFocus(
      '[data-candidates]',
      'Remove focuses the list without selecting the removed module',
    );
    await expectEmptySlot();
    await selectCandidate(
      `[data-candidates] [data-key="owned-${initialTransaction[1][0]}"]`,
      activation,
    );
    await focusDock('[data-command="EQUIP"]');
    await pressKey(activation);
    await expectFocus(
      '[data-command="REMOVE"]',
      'the Equip action returns focus to fitted module controls',
    );
    assert.deepEqual(
      await check('fixture.transactionState()'),
      initialTransaction,
      'removing and equipping preserves credits and module ownership',
    );
    await focusDock('[data-command="SELL"]');
    await pressKey(activation);
    await expectFocus(
      '[data-candidates]',
      'selling a fitted module focuses replacements for its empty slot',
    );
    await expectEmptySlot();
    assert(
      await check(
        `document.querySelector('[data-back-label]').textContent === 'Back'
          && document.querySelector('[data-loadout] [data-key="mount:0"]').getAttribute('aria-pressed') === 'true'`,
      ),
      'selling a module keeps its vacated slot selected',
    );
    const soldTransaction = await check('fixture.transactionState()');

    assert.equal(soldTransaction[1][0], null);
    assert.equal(
      soldTransaction[2].length,
      0,
      'selling a fitted module leaves no temporary cargo',
    );
    assert.equal(
      soldTransaction[3].length,
      initialTransaction[3].length + 1,
      'the sold module reaches station stock',
    );

    const catalogueKey = await check(
      `document.querySelector('[data-candidates] [data-key^="shop-"]').getAttribute('data-key')`,
    );

    await selectCandidate(
      `[data-candidates] [data-key="${catalogueKey}"]`,
      activation,
    );
    await focusDock('[data-command="BUY"]');
    await pressKey(activation);
    await expectFocus(
      '[data-command="REMOVE"]',
      'the Buy action automatically fits the purchased module and focuses Remove',
    );
    const boughtTransaction = await check('fixture.transactionState()');

    assert.equal(
      boughtTransaction[2].length,
      0,
      'the fitted purchase does not occupy cargo',
    );
    assert.notEqual(
      boughtTransaction[1][0],
      null,
      'the purchased instance occupies the selected mount',
    );
    await focusDock('[data-command="SELL"]');
    await pressKey(activation);
    await expectFocus(
      '[data-candidates]',
      'selling the automatically fitted purchase focuses replacements for its empty slot',
    );
    await expectEmptySlot();
    assert(
      await check(
        `!!document.querySelector('[data-candidates] [data-key="${catalogueKey}"]')`,
      ),
      'the catalogue option returns after selling the last owned copy',
    );
    await pressKey('Escape');

    await focusDock('[data-tab="trade"]');
    await pressKey('Enter');
    const stockIds = await check('fixture.moduleStock()');

    await focusDock(
      `[data-stock-items] [data-key="shop:module-${stockIds[1]}"]`,
    );
    await check('fixture.replaceTradeCargo()');
    await pressKey(activation);
    const tradeBought = await check('fixture.transactionState()');

    assert(
      tradeBought[2].includes(stockIds[1]) &&
        tradeBought[3].includes(stockIds[0]) &&
        !tradeBought[3].includes(stockIds[1]),
      'Trade buys the selected instance when identical modules share a name',
    );
    await expectFocus(
      '[data-stock-items] button',
      'buying a module returns to station stock',
    );
    await focusDock(
      `[data-trade-items] [data-key="cargo:module-${stockIds[1]}"]`,
    );
    await check('fixture.replaceTradeCargo()');
    await pressKey(activation);
    await expectFocus(
      '[data-tab="trade"]',
      'selling the only cargo module returns to the Trade tab',
    );
    assert.equal((await check('fixture.transactionState()'))[2].length, 0);

    await focusDock(
      `[data-stock-items] [data-key="shop:module-${stockIds[0]}"]`,
    );
    await check(`fixture.withdrawStock(${stockIds[0]})`);
    await expectFocus(
      '[data-stock-items] button',
      'stock disappearing while its row is focused returns to remaining stock',
    );
    assert(
      await check(
        `document.querySelector('[data-back-label]').textContent === 'Launch' && !document.querySelector('[data-stock-items] [aria-pressed="true"]')`,
      ),
      'withdrawn stock clears stale selection and detail navigation',
    );

    await check('fixture.beamLaser(); fixture.beamLaser()');
    const duplicateIds = (await check('fixture.transactionState()'))[2];

    await check('fixture.fillCargo()');
    await focusDock('[data-stock-items] button:first-child');
    await pressKey('Enter');
    assert(
      await check(
        `document.activeElement.getAttribute('aria-disabled') === 'true'`,
      ),
      'Trade disables the Buy row when cargo is full',
    );
    const fullTransaction = await check('fixture.transactionState()');

    await pressKey(activation);
    assert.deepEqual(
      await check('fixture.transactionState()'),
      fullTransaction,
      'activating an unavailable purchase leaves ownership and credits unchanged',
    );
    await focusDock('[data-tab="outfitting"]');
    await pressKey('Enter');
    await focusDock('[data-key="mount:1"]');
    await pressKey('Enter');
    assert(
      await check(
        `document.querySelector('[data-command="REMOVE"]').disabled && document.querySelector('[data-command="SELL"]').disabled`,
      ),
      'full cargo disables fitted-module actions that require removal',
    );
    await pressKey('Escape');
    await focusDock('[data-key="mount:0"]');
    await pressKey('Enter');
    await expectEmptySlot();
    await selectCandidate('[data-candidates] [data-key^="shop-"]', activation);
    assert(
      await check(`!document.querySelector('[data-command="BUY"]').disabled`),
      'Outfitting can buy directly into an empty mount when cargo is full',
    );
    await selectCandidate(
      `[data-candidates] [data-key="owned-${duplicateIds[1]}"]`,
      activation,
    );
    await focusDock('[data-command="EQUIP"]');
    await pressKey(activation);
    const fittedDuplicate = await check('fixture.transactionState()');

    assert.equal(
      fittedDuplicate[1][0],
      duplicateIds[1],
      'equipping the second identical module uses its exact ID',
    );
    assert(
      fittedDuplicate[2].includes(duplicateIds[0]) &&
        !fittedDuplicate[2].includes(duplicateIds[1]),
      'equipping frees cargo space without taking the other owned copy',
    );
    assert.equal(fittedDuplicate[2].length, fullTransaction[2].length - 1);
    await expectFocus(
      '[data-command="REMOVE"]',
      'equipping from full cargo leaves an enabled Remove action',
    );
    await pressKey(activation);
    await expectFocus(
      '[data-candidates]',
      'removing an identical module focuses the list with both copies unselected',
    );
    await expectEmptySlot();
    await selectCandidate(
      `[data-candidates] [data-key="owned-${duplicateIds[1]}"]`,
      activation,
    );
    await focusDock('[data-command="SELL"]');
    await pressKey(activation);
    const soldDuplicate = await check('fixture.transactionState()');

    assert(
      soldDuplicate[2].includes(duplicateIds[0]) &&
        !soldDuplicate[2].includes(duplicateIds[1]),
      'selling the second fitting candidate preserves the first copy',
    );
    await expectFocus(
      '[data-candidates]',
      'selling from full cargo keeps replacements for the empty slot focused',
    );
    await expectEmptySlot();
    await selectCandidate('[data-candidates] [data-key^="shop-"]', activation);
    await focusDock('[data-command="BUY"]');
    await pressKey(activation);
    const rejectedId = (await check('fixture.transactionState()'))[1][0];

    await check(`fixture.rejectPurchase(${rejectedId})`);
    await expectFocus(
      '[data-candidates]',
      'a rejected fitted purchase returns focus to the empty compatible list',
    );
    await expectEmptySlot();
  }

  await c.send('Page.reload');
  await pause(250);
  await check(
    `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
  );
  await pause(250);

  await click('[data-tab="overview"]');
  const fuelCredits = await check('fixture.fuelState()[1]');

  await check('fixture.setFuel(0, 23)');
  assert(
    await check(`document.querySelector('[data-refuel]').disabled`),
    'refuel requires enough credits',
  );
  await check('fixture.setFuel(0, 24)');
  assert(
    await check(
      `document.querySelector('[data-fuel]').textContent === '0.0/120 L'`,
    ),
  );
  await click('[data-refuel]');
  assert.deepEqual(
    await check('fixture.fuelState()'),
    [120, 0],
    'production refuel fills the tank and charges 24 credits',
  );
  assert(
    await check(`document.querySelector('[data-refuel]').disabled`),
    'full tank cannot be refilled',
  );
  await check(`fixture.setFuel(120, ${fuelCredits})`);
  await check(`document.activeElement.blur()`);

  const icon = await check(`(() => {
    const svg = document.querySelector('.dock-station-icon svg');
    const matrix = svg.getScreenCTM();
    const holder = svg.parentElement.getBoundingClientRect();
    const path = svg.querySelector('path');
    const length = path.getTotalLength();
    const points = Array.from({length: 1000}, (_, i) => path.getPointAtLength(i * length / 1000));
    return [
      Math.atan2(matrix.b, matrix.a),
      matrix.e - (holder.x + holder.width / 2),
      matrix.f - (holder.y + holder.height / 2),
      points.reduce((sum, point) => sum + point.x, 0) / points.length,
      points.reduce((sum, point) => sum + point.y, 0) / points.length,
    ];
  })()`);

  assert(Math.abs(icon[0]) < 0.00001, 'station icon remains unrotated');
  assert(
    icon.slice(1).every((value: number) => Math.abs(value) < 0.01),
    'station shape stays centered',
  );

  assert.deepEqual(
    await check(`fixture.previewEquivalence()`),
    [true, true, true, true],
    'saved and live ships render identically, idle previews stop drawing, and destroying an animated preview cancels its frame',
  );
  assert.deepEqual(
    await check(`fixture.itemPreviewFraming()`),
    [true, true, true, true],
    'sparkles and extra strokes zoom out without moving the item body off center or clipping the preview',
  );
  assert.deepEqual(
    await check(`fixture.previewOcclusion()`),
    [
      [255, 0, 255, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 128],
      [255, 255, 255, 255],
      [0, 255, 255, 255],
      [0, 0, 0, 0],
    ],
    'selected modules retain their layer, covered pixels stay hidden, and unselected overlaps stay at 50% opacity',
  );

  assert(
    await check(
      `!document.querySelector('[data-overview]').hidden && document.querySelector('[data-outfitting]').hidden`,
    ),
    'docking starts on Overview',
  );
  await checkHiddenElements();

  await click('[data-tab="trade"]');
  assert.deepEqual(
    await check(
      `Array.from(document.querySelectorAll('[data-stock-items] [data-key^="shop:"]'), button => button.querySelector('.dock-trade-name').textContent.trim())`,
    ),
    ['Autogun Ammo'],
    'Trade stocks ammunition only; modules are purchased in Outfitting',
  );
  assert.equal(
    await check(
      `document.querySelector('[data-stock-items] .dock-trade-supply').textContent`,
    ),
    '300',
    'new stations show 300 ammunition packs in the Supply column',
  );
  assert(
    await check(`(() => {
    const sell = document.querySelector('[data-sidebar]').getBoundingClientRect();
    const buy = document.querySelector('[data-trade-stock]').getBoundingClientRect();
    return Math.abs(sell.width - buy.width) < 1;
  })()`),
    'Trade has equal sell and buy columns',
  );
  await check(
    `document.querySelector('[data-stock-items] [data-key="shop:item-5"]').focus()`,
  );
  assert(
    await check(
      `document.querySelector('[data-title]').textContent === 'Autogun Ammo' && !document.querySelector('[data-detail-preview]').hidden && document.querySelector('[data-location]').textContent === document.querySelector('[data-station]').textContent`,
    ),
    'focusing stock previews its item with the station name without selecting it',
  );
  await click('[data-tab="outfitting"]');
  await pause(100);
  const wholeShip = await check(
    `document.querySelector('.dock-preview').toDataURL()`,
  );

  assert(
    await check(
      `!document.querySelector('.dock-energy').classList.contains('dock-inspecting')`,
    ),
    'outfitting does not automatically select a hull',
  );
  await hover('[data-key="hull:0"]');
  await pause(100);
  await check(`(() => {
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
    globalThis.thumbnailWrites = 0;
    document.querySelectorAll('[data-hull]').forEach(canvas => {
      Object.defineProperty(canvas, 'width', {
        configurable: true,
        get() { return width.get.call(this); },
        set(value) { globalThis.thumbnailWrites++; width.set.call(this, value); },
      });
    });
  })()`);
  await hover('[data-key="hull:1"]');
  await pause(100);
  await hover('[data-key="hull:0"]');
  await pause(100);
  assert.equal(
    await check('globalThis.thumbnailWrites'),
    0,
    'hovering between hulls reuses unchanged outline thumbnails',
  );
  assert(
    (await check(`document.querySelector('.dock-preview').toDataURL()`)) !==
      wholeShip,
    'hovering a hull highlights it',
  );
  assert(
    await check(
      `document.querySelector('[data-title]').textContent === 'Outfitting'`,
    ),
    'hovering a hull leaves the Outfitting summary card',
  );

  const groupGaps = await check(`(() => {
    const groups = document.querySelectorAll('.dock-group');
    return Array.from(groups).slice(0, 3).map((group, i) => {
      const last = group.lastElementChild, first = groups[i + 1].firstElementChild;
      const above = last.getBoundingClientRect(), below = first.getBoundingClientRect();
      return { x: above.x + above.width / 2, start: above.bottom, end: below.top,
        last: last.getAttribute('data-key'), first: first.getAttribute('data-key') };
    });
  })()`);

  for (const gap of groupGaps) {
    for (const offsets of [
      [-1, 1, 3, 5, 7, 9],
      [9, 7, 5, 3, 1, -1],
    ]) {
      for (const offset of offsets) {
        await c.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: gap.x,
          y: gap.start + offset,
        });

        assert.equal(
          await check(
            `document.querySelector('.dock-row:hover')?.getAttribute('data-key')`,
          ),
          offset < (gap.end - gap.start) / 2 ? gap.last : gap.first,
          'each neighboring button owns half the group gap in either direction',
        );
        assert(
          await check(
            `document.querySelector('.dock-energy').classList.contains('dock-inspecting')`,
          ),
          'moving between hull groups keeps the preview highlighted',
        );
      }
    }
  }

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 640,
    y: 150,
  });

  await pause(100);
  assert(
    (await check(`document.querySelector('.dock-preview').toDataURL()`)) ===
      wholeShip,
    'leaving an unselected hull restores the whole ship at full opacity',
  );
  await click('[data-key="hull:0"]');
  await hover('[data-key="hull:1"]');
  await pause(100);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 640,
    y: 150,
  });

  await pause(100);
  assert(
    await check(
      `document.querySelector('[data-location]').textContent === 'Hull 01' && document.querySelector('.dock-energy').classList.contains('dock-inspecting')`,
    ),
    'leaving hover restores the selected hull',
  );
  await click('[data-tab="outfitting"]');
  await check(`document.querySelector('[data-key="mount:2"]').focus()`);
  assert(
    await check(
      `document.querySelector('[data-fitting-preview]').hidden && document.querySelector('[data-title]').textContent === 'Outfitting' && !document.querySelector('[data-candidates] [aria-pressed="true"]')`,
    ),
    'focusing an empty slot does not preview the first compatible module',
  );

  for (const key of ['Enter', ' ']) {
    await check(`document.querySelector('[data-key="mount:2"]').focus()`);
    await pressKey(key);
    assert(
      await check(
        `document.activeElement.matches('[data-candidates]') && document.querySelector('[data-fitting-preview]').hidden`,
      ),
      'confirming an empty slot focuses the list without previewing the first module',
    );
    await expectEmptySlot();
    await pressKey('Tab');
    await expectFocus(
      '[data-candidates] button:first-child',
      'Tab from the list container reaches its first compatible module',
    );
    await expectEmptySlot();
  }

  await pressKey('Escape');
  assert(
    await check(
      `document.activeElement.getAttribute('data-key') === 'mount:2' && !fixture.inspect()[3] && document.querySelector('[data-back-label]').textContent === 'Launch'`,
    ),
    'Escape returns from compatible modules to the slot without launching',
  );
  await click('[data-key="hull:0"]');
  assert(
    await check(
      `document.activeElement.closest('.dock-detail') && document.querySelector('[data-back-label]').textContent === 'Back'`,
    ),
    'confirming a hull enters its detail card',
  );
  await check(
    `document.querySelector('[data-detail-preview]').style.width = '120px'`,
  );
  await pause(100);
  assert.equal(
    await check(`document.querySelector('[data-detail-preview]').width`),
    120,
    'resizing a hull thumbnail refreshes its pixel size without a state update',
  );
  await check(
    `document.querySelector('[data-detail-preview]').style.removeProperty('width')`,
  );
  await pause(100);
  assert.equal(
    await check(`document.querySelector('[data-detail-preview]').width`),
    160,
    'restoring the hull detail size redraws its thumbnail',
  );
  await pressKey('Escape');
  assert(
    await check(
      `document.activeElement.getAttribute('data-key') === 'hull:0' && !fixture.inspect()[3]`,
    ),
    'Escape returns from hull details to its row',
  );

  for (const key of ['hull:0', 'mount:0', 'mount:2']) {
    await click(`[data-key="${key}"]`);

    if (key === 'mount:0') {
      await check(`document.querySelector('[data-key="${key}"]').focus()`);
    }

    await hover('[data-key="hull:1"]');
    await pause(100);
    await pressKey('Escape');
    assert(
      await check(
        `document.activeElement.getAttribute('data-key') === '${key}' && !document.querySelector('[data-loadout] [aria-pressed="true"]') && !document.querySelector('[data-candidates] [aria-pressed="true"]') && !fixture.inspect()[3] && document.querySelector('[data-back-label]').textContent === 'Launch'`,
      ),
      'Escape clears selection and fitting candidates and restores the original row focus, even after hovering another row',
    );

    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 640,
      y: 150,
    });

    await check(`document.activeElement.blur()`);
    assert(
      await check(
        `!document.querySelector('.dock-energy').classList.contains('dock-inspecting')`,
      ),
      'clearing hover and focus after Escape leaves no persistent preview highlight',
    );
  }

  for (const key of ['hull:0', 'mount:0', 'mount:2']) {
    await click(`[data-key="${key}"]`);

    if (key === 'mount:2') {
      assert(
        await check(
          `!document.querySelector('[data-candidates] [aria-pressed="true"]')`,
        ),
      );
      await expectEmptySlot();
    }

    const committed = await committedDockState();
    const card = await check(
      `document.querySelector('.dock-detail').outerHTML`,
    );

    await hover('[data-key="hull:1"]');
    await pause(100);
    assert.equal(
      await check(`document.querySelector('.dock-detail').outerHTML`),
      card,
      'hover preserves the selected card and candidate',
    );
    assert.deepEqual(await committedDockState(), committed);
    await check(`document.querySelector('[data-key="mount:5"]').focus()`);
    await pressKey('ArrowUp');
    assert.equal(
      await check(`document.querySelector('.dock-detail').outerHTML`),
      card,
      'arrow focus preserves the selected card and candidate',
    );
    assert.deepEqual(await committedDockState(), committed);
    await pressKey('Escape');
    assert(
      await check(
        `document.querySelector('[data-title]').textContent === 'Outfitting'`,
      ),
      'Escape clears the card even though the original row regains focus',
    );
  }

  await click('[data-key="mount:2"]');
  assert(
    await check(
      `document.activeElement.matches('[data-candidates]') && document.querySelector('[data-fitting-preview]').hidden`,
    ),
    'clicking an empty slot focuses the list without inspecting a candidate',
  );
  await expectEmptySlot();
  await click('[data-loadout] [data-key="mount:0"]');
  assert(
    await check(`document.activeElement.matches('[data-command="REMOVE"]')`),
    'selecting a healthy fitted module focuses Remove',
  );
  await check(
    `window.detailButtons = [...document.querySelectorAll('.dock-detail button:not(:disabled)')].filter(button => button.getClientRects().length)`,
  );

  for (let index = 1; index < (await check('detailButtons.length')); index++) {
    await pressKey(
      index >
        (await check(
          `detailButtons.findIndex(button => button.hasAttribute('data-paint'))`,
        ))
        ? 'ArrowRight'
        : 'ArrowDown',
    );
    assert(
      await check(`document.activeElement === detailButtons[${index}]`),
      'Down advances through the module actions and paint buttons',
    );
  }

  await pressKey('ArrowLeft');
  assert(
    await check(`document.activeElement === detailButtons.at(-2)`),
    'Left returns to the preceding paint swatch',
  );
  const beforePreview = await check(`fixture.previewState()`);

  await check(`document.querySelector('[data-key="mount:0"]').focus()`);
  await pressKey('ArrowDown');
  assert(
    await check(`document.activeElement.getAttribute('data-key') === 'hull:2'`),
    'arrows advance through hull/module rows',
  );
  await pressKey('Tab');
  assert(
    await check(`document.activeElement.getAttribute('data-key') === 'hull:3'`),
    'Tab uses native row order',
  );
  await click('[data-key="hull:0"]');
  await pause(100);
  assert.equal(
    await check(`(() => {
      const canvas = document.querySelector('.dock-preview');
      const pixels = canvas.getContext('2d').getImageData(0, Math.floor(canvas.height * .65), canvas.width, Math.floor(canvas.height * .35)).data;
      let alpha = 0;
      for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
      return alpha;
    })()`),
    128,
    'all unselected hulls and modules share one 50% opacity composite, including overlaps',
  );
  await click('[data-key="hull:1"]');
  assert(
    await check(`(() => {
      const canvas = document.querySelector('[data-detail-preview]').getBoundingClientRect();
      const card = document.querySelector('.dock-detail').getBoundingClientRect();
      return Math.abs(canvas.x + canvas.width / 2 - card.x - card.width / 2) < 1;
    })()`),
    'hull thumbnail is centered in its card',
  );
  await capture('docked-hull');
  await click('[data-key="mount:5"]');
  assert.deepEqual(
    await check(`fixture.previewState()`),
    beforePreview,
    'preview does not activate live modules',
  );
  await check(`fixture.damageHull()`);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 640,
    y: 150,
  });

  await check(`document.querySelector('[data-loadout] button').focus()`);
  await pressKey('ArrowUp');
  assert(
    await check(`document.activeElement.matches('[data-tab="outfitting"]')`),
    'Up from the first loadout row reaches the Outfitting tab',
  );
  await click('[data-key="hull:0"]');
  await click('[data-command="FIX"]');
  assert.equal((await check(`fixture.hullHealth()`))[0], 12);
  await click('[data-key="mount:0"]');
  await click('[data-command="REMOVE"]');
  await expectEmptySlot();
  await capture('docked-empty-slot');
  assert(
    await check(`document.querySelector('[data-fitting-preview]').hidden`),
    'removing a module does not immediately preview a replacement',
  );
  const autogun = await check(
    `Array.from(document.querySelectorAll('[data-candidates] button')).find(x=>x.textContent.includes('Autogun')).getAttribute('data-key')`,
  );

  const beforeAutogunSelection = await check('fixture.transactionState()');

  await click(`[data-candidates] [data-key="${autogun}"]`);
  assert.deepEqual(
    await check('fixture.transactionState()'),
    beforeAutogunSelection,
    'clicking a shop candidate selects it without buying it',
  );
  assert(
    await check(`!document.querySelector('[data-fitting-preview]').hidden`),
    'an explicitly selected candidate labels power totals as a fitting preview',
  );
  await capture('docked-compatible-module');
  await click('[data-command="BUY"]');
  assert.deepEqual(await check(`fixture.inspect().slice(0,3)`), [
    1390,
    1,
    true,
  ]);
  assert(
    await check(
      `document.querySelector('[data-command="EQUIP"]').hidden && !document.querySelector('[data-command="REMOVE"]').hidden`,
    ),
    'buying automatically fits the selected module and shows fitted actions',
  );
  const beforeAmmo = await check(`fixture.inspect()`);

  assert(
    await check(
      `!document.querySelector('[data-command="BUY_AMMO"]').hidden && document.querySelector('[data-ammo-price]').textContent === '2$'`,
    ),
    'an ammunition-consuming module offers its stocked ammunition at the pack price',
  );
  await check(`document.querySelector('[data-command="BUY_AMMO"]').focus()`);
  await pressKey('Enter');
  assert.deepEqual(
    await check(`fixture.inspect().slice(0, 3)`),
    [beforeAmmo[0] - 2, beforeAmmo[1] + 1, true],
    'buying ammunition from the module card charges for one cargo pack and keeps the module fitted',
  );
  assert(
    await check(
      `document.querySelector('[data-title]').textContent === 'Autogun'`,
    ),
    'buying ammunition keeps the selected module card open',
  );
  await click('[data-tab="trade"]');
  const ammoCargo = await check(
    `Array.from(document.querySelectorAll('[data-trade-items] [data-key^="cargo:"]')).find(button => button.textContent.includes('Autogun Ammo')).getAttribute('data-key')`,
  );

  await click(`[data-trade-items] [data-key="${ammoCargo}"]`);
  assert.deepEqual(await check(`fixture.inspect()`), beforeAmmo);
  await click('[data-tab="outfitting"]');
  await click('[data-key="mount:0"]');
  assert(
    await check(`document.querySelector('[data-fitting-preview]').hidden`),
    'fitted power totals are no longer a preview',
  );
  await check(`fixture.damage()`);
  assert(await check(`!document.querySelector('[data-command="FIX"]').hidden`));
  await click('[data-command="FIX"]');
  assert(
    await check(`document.querySelector('[data-command="FIX"]').disabled`),
  );
  await checkHiddenElements();
  await click('[data-command="REMOVE"]');
  assert.equal((await check(`fixture.inspect()`))[2], false);
  const beforeRefit = await check(`fixture.inspect()[0]`);
  const ownedAutogun = await check(
    `Array.from(document.querySelectorAll('[data-candidates] button')).find(x=>x.textContent.includes('Autogun')).getAttribute('data-key')`,
  );

  await click(`[data-candidates] [data-key="${ownedAutogun}"]`);
  assert.equal(
    (await check(`fixture.inspect()`))[2],
    false,
    'clicking an owned candidate selects it without equipping it',
  );
  await click('[data-command="EQUIP"]');
  assert.equal(
    (await check(`fixture.inspect()`))[2],
    true,
    'Equip fits the selected owned compatible module',
  );
  assert.equal(
    await check(`fixture.inspect()[0]`),
    beforeRefit,
    'equipping an owned module does not buy it again',
  );
  await click('[data-command="REMOVE"]');
  await expectEmptySlot();
  await click(`[data-candidates] [data-key="${ownedAutogun}"]`);
  await click('[data-command="EQUIP"]');
  await click('[data-command="SELL"]');
  await expectEmptySlot();
  assert.equal((await check(`fixture.inspect()`))[1], 1);
  await click('[data-tab="trade"]');
  const soldModule = await check(
    `Array.from(document.querySelectorAll('[data-stock-items] button')).find(button => button.textContent.includes('Autogun') && !button.textContent.includes('Ammo')).getAttribute('data-key')`,
  );

  await hover(`[data-key="${soldModule}"]`);
  await pause(100);
  assert(
    await check(
      `document.querySelector('[data-title]').textContent === 'Autogun' && !document.querySelector('[data-detail-preview]').hidden && document.querySelector('[data-location]').textContent === document.querySelector('[data-station]').textContent`,
    ),
    'hovered sold module shows the station name and a preview',
  );
  await capture('docked-trade-module');
  const moduleImage = await check(
    `document.querySelector('[data-detail-preview]').toDataURL()`,
  );
  const beforeBuyback = await check(`fixture.inspect()`);

  await click(`[data-key="${soldModule}"]`);
  assert.equal(
    (await check(`fixture.inspect()`))[1],
    beforeBuyback[1] + 1,
    'Trade can repurchase a sold module',
  );
  await check(`fixture.tradeCargo()`);
  await hover('[data-key="cargo:item-0"]');
  await pause(100);
  assert(
    await check(
      `document.querySelector('[data-title]').textContent === 'Diamond' && document.querySelector('[data-location]').textContent === 'Cargo'`,
    ),
    'hovering a cargo item opens the Trade card labeled Cargo',
  );
  assert.notEqual(
    await check(`document.querySelector('[data-detail-preview]').toDataURL()`),
    moduleImage,
    'item and module previews render different game geometry',
  );
  await capture('docked-trade-item');
  await click('[data-key="cargo:item-0"]');
  await click('[data-key="shop:item-0"]');
  assert(
    await check(
      `Boolean(document.querySelector('[data-key="cargo:item-0"]')) && !document.querySelector('[data-key="shop:item-0"]')`,
    ),
    'buying an item moves it from station stock back to cargo',
  );
  await click(`[data-key="${soldModule.replace('shop:', 'cargo:')}"]`);
  assert.equal(
    await check(`fixture.inspect()[0]`),
    beforeBuyback[0],
    'the Trade round trip restores the balance needed by subsequent Outfitting checks',
  );

  const laserPrice = await check(`fixture.beamLaser()`);
  const laserKey = await check(
    `Array.from(document.querySelectorAll('[data-trade-items] button')).find(button => button.textContent.includes('Beam Laser')).getAttribute('data-key')`,
  );
  const beforeLaserSale = await check(`fixture.inspect()`);

  await focusDock(`[data-key="${laserKey}"]`);
  await check(`fixture.replaceTradeCargo()`);
  await pressKey('Enter');
  assert.deepEqual(
    (await check(`fixture.inspect()`)).slice(0, 2),
    [beforeLaserSale[0] + laserPrice, beforeLaserSale[1] - 1],
    'selling the selected Beam Laser survives replacement by an equivalent replicated module',
  );
  const laserStockKey = await check(
    `Array.from(document.querySelectorAll('[data-stock-items] button')).find(button => button.textContent.includes('Beam Laser')).getAttribute('data-key')`,
  );

  await focusDock(`[data-key="${laserStockKey}"]`);
  await check(`fixture.replaceTradeCargo()`);
  await pressKey('Enter');
  assert.deepEqual(
    (await check(`fixture.inspect()`)).slice(0, 2),
    beforeLaserSale.slice(0, 2),
    'repurchasing the selected Beam Laser survives equivalent station stock replacement',
  );

  const beforeTradeNavigation = await check(`fixture.inspect()`);

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 10,
    y: 10,
  });

  await check(
    `document.querySelector('[data-trade-items] button:last-child').focus()`,
  );
  await pressKey('ArrowRight');
  assert(
    await check(
      `document.activeElement.closest('[data-stock-items]') && !document.querySelector('[data-stock-items] [aria-pressed="true"]')`,
    ),
    'Right focuses a Buy row without selecting it, clamping to the shorter column',
  );
  await pressKey('ArrowLeft');
  assert(
    await check(
      `document.activeElement.closest('[data-trade-items]') && !document.querySelector('[data-trade-items] [aria-pressed="true"]')`,
    ),
    'Left focuses a Sell row without selecting it',
  );
  assert.deepEqual(
    await check(`fixture.inspect()`),
    beforeTradeNavigation,
    'column navigation does not buy or sell anything',
  );
  await click('[data-tab="overview"]');
  await click('[data-hull-paint]');
  await click('[data-paints] button:nth-child(6)');
  assert(
    await check(
      `document.querySelector('[data-paints] button:nth-child(6)').getAttribute('aria-pressed') === 'true'`,
    ),
  );
  assert(
    await check(
      `document.querySelector('[data-hull-paint]').getAttribute('aria-pressed') === 'true'`,
    ),
    'Hull Paint stays pressed while choosing a paint',
  );

  for (const [button, background] of [
    ['[data-key="hull:0"]', '.dock-preview'],
    ['[data-key="mount:1"]', '.dock-preview'],
    ['[data-hull-paint]', '[data-ship-name]'],
  ]) {
    const painting = button === '[data-hull-paint]';

    await click(`[data-tab="${painting ? 'overview' : 'outfitting'}"]`);
    await click(button);
    const title = await check(
      `document.querySelector('[data-title]').textContent`,
    );

    for (const content of [
      '[data-location]',
      '[data-title]',
      '[data-description]',
    ]) {
      if (
        !(await check(
          `!!document.querySelector('${content}').getClientRects().length`,
        ))
      ) {
        continue;
      }

      await click(content);
      assert(
        await check(`document.querySelector('${button}').getAttribute('aria-pressed') === 'true'
          && document.querySelector('[data-title]').textContent === ${JSON.stringify(title)}
          && document.querySelector('[data-back-label]').textContent === 'Back'`),
        'clicking card content preserves the selected object and its details',
      );
    }

    const [x, y] = await check(`(() => {
      const box = document.querySelector('.dock-detail').getBoundingClientRect();
      return [box.x + 8, box.y + 8];
    })()`);

    for (const type of ['mousePressed', 'mouseReleased']) {
      await c.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    }

    assert(
      await check(`document.querySelector('${button}').getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-title]').textContent === ${JSON.stringify(title)}`),
      'clicking card padding preserves the selected object and its details',
    );
    await click(background);
    assert(
      await check(`document.querySelector('[data-title]').textContent === '${painting ? 'Ship overview' : 'Outfitting'}'
        && !document.querySelector('[data-loadout] [aria-pressed="true"]')
        && document.querySelector('[data-hull-paint]').getAttribute('aria-pressed') === 'false'
        && !document.querySelector('.dock-energy').classList.contains('dock-inspecting')
        && document.querySelector('[data-back-label]').textContent === 'Launch'
        && !document.querySelector('.dock-screen :focus')`),
      'clicking outside the card clears selection, inspection and detail focus',
    );
  }

  await click('[data-tab="outfitting"]');
  await check(
    `document.querySelector('[data-loadout] [data-key="hull:0"]').focus(); window.focusedRow = document.activeElement; fixture.refresh()`,
  );
  assert(
    await check(`document.activeElement === focusedRow`),
    'updates preserve focus',
  );
  await check(
    `window.savedThumbnail = focusedRow.querySelector('canvas'); fixture.damageHull()`,
  );
  assert(
    await check(
      `document.activeElement === focusedRow && focusedRow.querySelector('canvas') === savedThumbnail && focusedRow.textContent.includes('2/12')`,
    ),
    'changing hull health updates the existing focused row and keeps its thumbnail canvas',
  );

  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await click('[data-tab="overview"]');
  await pause(150);
  await capture('docked-overview');
  await click('[data-tab="outfitting"]');
  await click('[data-key="mount:0"]');
  const plasma = await check(
    `Array.from(document.querySelectorAll('[data-candidates] button')).find(x=>x.textContent.includes('Plasma Accelerator')).getAttribute('data-key')`,
  );

  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 640,
    y: 150,
  });

  await check(
    `document.querySelector('[data-candidates] [data-key="${plasma}"]').focus()`,
  );
  await pressKey(' ');
  assert(
    await check(
      `document.querySelector('[data-candidates] [aria-pressed="true"]').getAttribute('data-key') === '${plasma}'`,
    ),
    'Space selects the focused shop module',
  );
  await expectFocus(
    '[data-command="BUY"]',
    'Space on a shop module moves focus directly to Buy',
  );
  await pressKey(' ');
  await expectFocus(
    '[data-command="REMOVE"]',
    'Space on Buy fits the purchased module and focuses Remove',
  );
  await pause(150);
  assert(
    await check(
      `(() => { const row = document.querySelector('[data-key="mount:0"] > :nth-child(2)'), title = document.querySelector('[data-title]'); return [row,title].every(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length===1 && el.scrollWidth<=el.clientWidth+1;}); })()`,
    ),
    'Plasma Accelerator fits in both columns at 16:9',
  );
  assert(
    await check(
      `(() => { const markers = Array.from(document.querySelectorAll('.dock-energy .ui-power-marker')); return markers.length > 0 && markers.every(el=>getComputedStyle(el).opacity==='1'); })()`,
    ),
    'generation markers stay fully opaque',
  );
  assert(
    await check(
      `Array.from(document.querySelectorAll('.dock-screen svg')).every(el=>el.getAttribute('aria-hidden')==='true' && el.getAttribute('fill')==='none' && el.getAttribute('stroke')==='currentColor' && (!el.getClientRects().length || [el.getBoundingClientRect().width, el.getBoundingClientRect().height].every(size => size === (el.closest('.dock-station-icon') ? 48 : 16))))`,
    ),
    'icons use current-color strokes and are hidden from assistive technology',
  );
  assert(
    await check(`(() => {
      const row = document.querySelector('[data-key="mount:0"]');
      const style = getComputedStyle(row);
      return ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'].every(key => style[key] !== style.backgroundColor);
    })()`),
    'selected rows preserve all border colors',
  );
  assert(
    await check(
      `document.querySelector('[data-health]').textContent === '20/20'`,
    ),
    'module maximum health is retained across the lazy boundary',
  );

  for (const width of [1280, 1920]) {
    await c.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: (width * 9) / 16,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await pause(100);
    assert(
      await check(`(() => {
        const title = document.querySelector('[data-title]');
        return title.getBoundingClientRect().height <= parseFloat(getComputedStyle(title).lineHeight) + 1 && title.scrollWidth <= title.clientWidth;
      })()`),
      'Plasma Accelerator fits the detail heading on one line at desktop widths',
    );
    await capture(`docked-outfitting-${width}`);
  }

  await check(`document.querySelector('[data-key="mount:5"]').focus()`);
  await pressKey('ArrowUp');
  assert(
    await check(`(() => {
      const style = getComputedStyle(document.activeElement);
      return ['borderRightColor', 'borderBottomColor', 'borderLeftColor'].every(key => style[key] === style.borderTopColor);
    })()`),
    'keyboard focus colors all four row borders',
  );
  await click('[data-key="hull:1"]');
  await pause(1000);
  const inactiveWeapon = await check(
    `document.querySelector('.dock-preview').toDataURL()`,
  );

  await click('[data-key="mount:0"]');
  await pause(100);
  const deployingWeapon = await check(
    `document.querySelector('.dock-preview').toDataURL()`,
  );

  await pause(1000);
  const deployedWeapon = await check(
    `document.querySelector('.dock-preview').toDataURL()`,
  );

  assert(
    deployingWeapon !== inactiveWeapon && deployingWeapon !== deployedWeapon,
    'weapon preview passes through deployment frames',
  );
  await click('[data-key="hull:1"]');
  await pause(100);
  const retractingWeapon = await check(
    `document.querySelector('.dock-preview').toDataURL()`,
  );

  assert(
    retractingWeapon !== inactiveWeapon,
    'weapon preview retracts instead of snapping closed',
  );
  await pause(1000);
  assert(
    (await check(`document.querySelector('.dock-preview').toDataURL()`)) ===
      inactiveWeapon,
    'weapon preview finishes retracting',
  );
  await capture('docked-hull');
  const beforeShieldPurchase = await check('fixture.transactionState()');

  await click('[data-key="mount:2"]');
  assert(
    await check(
      `!document.querySelector('[data-candidates] [aria-pressed="true"]')`,
    ),
  );
  await expectEmptySlot();
  await selectCandidate('[data-candidates] button:first-child');
  const shieldPreview = await committedDockState();

  await hover('[data-command="BUY"]');
  assert.deepEqual(
    await committedDockState(),
    shieldPreview,
    'moving from the selected candidate to Buy preserves selection without purchasing it',
  );
  assert(
    await check(`!document.querySelector('[data-command="BUY"]').hidden`),
    'the previewed Buy action stays available when mouse navigation takes over',
  );
  await click('[data-command="BUY"]');
  const boughtShield = await check('fixture.transactionState()');

  assert(boughtShield[0] < beforeShieldPurchase[0]);
  assert.equal(
    boughtShield[2].length,
    beforeShieldPurchase[2].length,
    'clicking Buy fits the previewed module without consuming cargo space',
  );
  const equippedShield = boughtShield;

  assert.notEqual(
    equippedShield[1][2],
    null,
    'clicking Buy fits the purchased shield to the selected mount',
  );
  assert.equal(equippedShield[2].length, beforeShieldPurchase[2].length);
  await click('[data-key="hull:3"]');
  await pause(300);
  const shieldHeight = () =>
    check(`(() => {
    const canvas = document.querySelector('.dock-preview');
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let top = canvas.height, bottom = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 240) { top = Math.min(top,y); bottom = Math.max(bottom,y); }
      }
    }
    return bottom-top;
  })()`);
  const closedShield = await shieldHeight();

  await click('[data-key="mount:2"]');
  await pause(70);
  const expandingShield = await shieldHeight();

  await pause(250);
  const expandedShield = await shieldHeight();

  assert(
    expandingShield < expandedShield && closedShield < expandedShield,
    'shield preview expands over time',
  );
  await click('[data-key="hull:3"]');
  await pause(30);
  assert(
    (await shieldHeight()) > closedShield,
    'shield preview shrinks instead of snapping closed',
  );
  await pause(250);
  assert.equal(
    await shieldHeight(),
    closedShield,
    'shield preview finishes shrinking',
  );
  await pressKey('Escape');
  assert.equal(
    (await check(`fixture.inspect()`))[3],
    false,
    'first Escape leaves hull details without launching',
  );
  await pressKey('Escape');
  assert.equal((await check(`fixture.inspect()`))[3], true);
  assert(!(await check(`!!document.querySelector('[data-loadout]')`)));
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
  assert(!(await check(`!!document.querySelector('[data-loadout]')`)));

  for (const tab of ['overview', 'outfitting', 'trade', 'services']) {
    for (const activation of ['Enter', ' ', 'Escape']) {
      await c.send('Page.reload');
      await pause(250);
      await check(
        `(async () => { window.fixture = await import('./fixture.js'); fixture.dock(); })()`,
      );
      await pause(250);
      await focusDock(`[data-tab="${tab}"]`);
      await pressKey('Enter');
      await focusDock('[data-launch]');
      await pressKey(activation);
      assert(
        await check(
          `fixture.inspect()[3] && !document.querySelector('.dock-screen')`,
        ),
        `${activation} launches from the ${tab} footer without a selected detail`,
      );
    }
  }

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
