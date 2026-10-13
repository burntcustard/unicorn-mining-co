import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { simulationStep } from '../../src/specs/simulation.ts';
import {
  setupGameplay,
  createGameplayWorkload,
  measureGameplay,
} from './gameplay-workload.ts';

// Keep the standard development server pair running; this owns only its browser.
const browserName = process.argv[2] || 'chrome';
const seconds = Number(process.argv[3] || 30);
const output =
  process.argv[4] || `benchmarking/local/gameplay-${browserName}.json`;
const baseline = process.env.GAMEPLAY_BASELINE;
const [width, height] = (process.env.GAMEPLAY_RESOLUTION || '2560x1440')
  .split('x')
  .map(Number);
const fullscreen = width === 3840 && height === 2160;
const rendererPreference = process.env.GAMEPLAY_RENDERER || 'auto';

assert(width > 0 && height > 0, 'Use a resolution such as 3840x2160');
assert(['auto', 'canvas', 'webgl'].includes(rendererPreference));

if (baseline) {
  assert(/^[\da-f]{40}$/.test(baseline), 'Use a complete commit hash');
}

assert(['chrome', 'firefox'].includes(browserName), 'Choose chrome or firefox');
assert(
  seconds > 0 && seconds <= 60,
  'Capture between 1 and 60 seconds per workload',
);
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const root = process.cwd();
const directory = resolve(
  `benchmarking/local/production-gameplay-${process.pid}`,
);
const entry = resolve('src/__performance_fixture.ts');
const setup = setupGameplay.replace(
  /\s+window\.loadedGameModule =[\s\S]*?(?=\s+const \{ default: gameplay \})/,
  '',
);
const workload = (flight = false, large = false) =>
  createGameplayWorkload({ flight, large })
    .replace(
      "await import('/src/specs/items/index.ts')",
      "await loadedGameModule('specs/items.ts')",
    )
    .replace(
      "await import('/src/specs/simulation.ts')",
      "await loadedGameModule('specs/simulation.ts')",
    );
const modules = [
  'gameplay.ts',
  'network/network.ts',
  'game.ts',
  'player.ts',
  'ui/dom/ui.ts',
  'objects/create-ship.ts',
  'objects/asteroid.ts',
  'objects/item.ts',
  'objects/modules/index.ts',
  'objects/station.ts',
  'prediction/prediction.ts',
  'simulation/world.ts',
  'input/input.ts',
  'camera.ts',
];
const code = `
${modules.map((name, index) => `import * as m${index} from '${root}/src/client/${name}';`).join('\n')}
import * as itemSpecs from '${root}/src/specs/items/index.ts';
import * as simulation from '${root}/src/specs/simulation.ts';
const modules = new Map([${modules.map((name, index) => `[${JSON.stringify(name)},m${index}]`).join(',')}, ['specs/items.ts',itemSpecs],['specs/simulation.ts',simulation]]);
const loadedGameModule = name => Promise.resolve(modules.get(name));
const {game}=m2, {network}=m1, {player}=m3;
const {camera}=m13;
let perfFixture;
Reflect.set(window, 'perf-capture', async action => {
  if(action==='setup') return JSON.stringify(await (${setup}));
  if(action==='prepare'){
    const start=performance.now();
    while(player.ship.dockedTo || player.ship.launching){
      if(performance.now()-start>10000) throw Error('The normal launch transition did not finish');
      m12.playerInput.launch=Boolean(player.ship.dockedTo);network.recordInput({input:m12.playerInput});
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    m12.playerInput.launch=false;network.recordInput({input:m12.playerInput});m4.ui.clear();
    return 'ready';
  }
  if(action==='fixture'){await (${workload().replaceAll('window.perfFixture', 'perfFixture')});return 'fixture';}
  if(action==='flight'){await (${workload(true).replaceAll('window.perfFixture', 'perfFixture')});return 'flight';}
  if(action==='large'){await (${workload(false, true).replaceAll('window.perfFixture', 'perfFixture')});return 'large';}
  if(action==='live'){
    const hold=()=>{if(m12.playerInput.thrust!==1 || m12.playerInput.turn!==0 || !m12.playerInput.searchLight){m12.playerInput.thrust=1;m12.playerInput.turn=0;m12.playerInput.searchLight=true;network.recordInput({input:m12.playerInput});}};
    hold();
    if(!Reflect.get(window,'perf-live-input')){const original=network.updateFrame;network.updateFrame=options=>{hold();return original.call(network,options)};Reflect.set(window,'perf-live-input',true);}
    return 'live';
  }
  if(action==='measure'){
    const result=await (${measureGameplay(seconds * 1000).replaceAll('window.perfFixture', 'perfFixture')});
    return JSON.stringify(Object.fromEntries([
      ['fps',result.fps],['frames',result.frames],['p95',result.p95],['p99',result.p99],['missed',result.missed],['max',result.max],
      ['fps-windows',result.fpsWindows],
      ['stalls',result.stalls],
      ['cpu',[result.cpu.mean,result.cpu.p95,result.cpu.p99,result.cpu.max]],
      ['update',[result.update.mean,result.update.p95,result.update.p99,result.update.max]],
      ['prediction',[result.prediction.mean,result.prediction.p95,result.prediction.p99,result.prediction.max]],
      ['messages',[result.messages.mean,result.messages.p95,result.messages.p99,result.messages.max]],['message-count',result.messageCount],
      ['viewport',result.viewport],['canvas',result.canvas],['zoom',result.zoom],['rounds',result.rounds],['alive',result.alive],
      ['context-attributes',game.ctx.getContextAttributes()],
      ['audio-state',Reflect.get(window,'perf-audio-context')?.state || 'absent'],
      ['browser-errors',Reflect.get(window,'perf-errors')],
      ['scene-surfaces',document.querySelectorAll('.world-surface').length],
      ['surface-style-errors',[...document.querySelectorAll('.world-surface')].filter(element=>!element.style.cssText.includes('matrix(') || element.style.cssText.includes('NaN')).length],
      ['background-style-errors',[...document.querySelectorAll('.background-layer')].filter(element=>!element.style.cssText.includes('translate(')).length],
      ['visible-rocks',result.visibleRocks],
      ['ship-docked',Boolean(player.ship.dockedTo)],
      ['ui-active',Boolean(m4.ui.current)],
      ['field-wraps',perfFixture?.wraps || 0],
      ['movement',result.movement],['camera-movement',result.cameraMovement],
      ['document-extent',[document.documentElement.clientWidth,document.documentElement.clientHeight,document.documentElement.scrollWidth,document.documentElement.scrollHeight]],
      ['splits',perfFixture?.events['asteroidSplit']||0],['destroyed',perfFixture?.events['asteroidDestroyed']||0],
      ['light-active',player.ship.moduleActive({module:m8.SearchLight})],
      ['asteroids',game.sprites.filter(object=>object.kind==='asteroid').length]
    ]));
  }
});`;

const diagnostic = process.env.GAMEPLAY_NO_LIGHTEN
  ? `const composite=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'globalCompositeOperation');Object.defineProperty(game.ctx,'globalCompositeOperation',{get(){return composite.get.call(this)},set(value){composite.set.call(this,value==='lighten'?'source-over':value)}});`
  : '';

await Promise.all(
  ['http://localhost:3000/', 'http://localhost:3001/healthz'].map(
    async (url) => {
      assert(
        (await fetch(url)).ok,
        `Start the standard development services before testing: ${url}`,
      );
    },
  ),
);

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'gameplay-performance',
      resolveId: (id) => (id === entry ? id : undefined),
      load: async (id) => {
        if (id === entry) return code + diagnostic;

        if (
          baseline &&
          id.startsWith(`${root}/src/client/`) &&
          id.endsWith('.ts')
        ) {
          return execFileSync(
            'git',
            ['show', `${baseline}:${relative(root, id)}`],
            { encoding: 'utf8' },
          );
        }

        if (id.endsWith('?raw')) {
          return `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))}`;
        }

        if (id.endsWith('.css')) return { code: '', moduleType: 'js' };
      },
      transform: (source, id) => {
        if (
          (process.env.GAMEPLAY_SOFTWARE || process.env.GAMEPLAY_GPU) &&
          id.endsWith('/client/core.ts')
        ) {
          return source.replace(
            /canvas\.getContext\('2d'[^;]*\)/,
            `canvas.getContext('2d', {willReadFrequently: ${!process.env.GAMEPLAY_GPU}})`,
          );
        }
      },
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

await mkdir(directory, { recursive: true });

await bundle.write({
  dir: directory,
  format: 'esm',
  minify: !process.env.GAMEPLAY_PROFILE,
  entryFileNames: 'fixture.js',
  chunkFileNames: '[name]-[hash].js',
});

await bundle.close();

// Shipping HTML builds the first-paint background separately, without gameplay
// property rewrites. Keep that boundary here too, including native CSS names.
const backgroundBundle = await rolldown({
  input: resolve('src/client/background/background-boot.ts'),
  plugins: [
    {
      name: 'background-baseline',
      load: (id) =>
        baseline && id.startsWith(`${root}/src/client/`) && id.endsWith('.ts')
          ? execFileSync('git', ['show', `${baseline}:${relative(root, id)}`], {
              encoding: 'utf8',
            })
          : undefined,
    },
    buildPrePlugin(),
  ],
});

const { output: backgroundOutput } = await backgroundBundle.generate({
  format: 'iife',
  name: 'background',
  minify: true,
});

await backgroundBundle.close();
await writeFile(
  join(directory, 'index.html'),
  `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/client/style.css"></head><body><canvas id="background-canvas"></canvas><canvas id="canvas"></canvas><script>localStorage.setItem('unicorn-renderer',${JSON.stringify(rendererPreference)});${backgroundOutput[0].code}</script><script type="module" src="./fixture.js"></script></body></html>`,
);

const portProbe = createServer();

await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const address = portProbe.address();

assert(address && typeof address !== 'string');
const port = address.port;

await new Promise<void>((resolve) => portProbe.close(() => resolve()));
const profile = await mkdtemp(join(tmpdir(), 'unicorn-gameplay-'));

if (process.env.GAMEPLAY_PROFILE && browserName === 'firefox') {
  await writeFile(
    join(profile, 'user.js'),
    `user_pref("browser.download.folderList", 2);\nuser_pref("browser.download.dir", ${JSON.stringify(resolve('benchmarking/local'))});\n`,
  );
}

const url = `http://localhost:3000/benchmarking/local/production-gameplay-${process.pid}/`;
const child = spawn(
  browserName === 'chrome'
    ? process.env.CHROME_BIN || 'google-chrome'
    : process.env.FIREFOX_BIN || 'firefox',
  browserName === 'chrome'
    ? [
        '--new-window',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        `--window-position=${fullscreen ? '0,0' : '30,30'}`,
        `--window-size=${width + 40},${height + 140}`,
        '--force-device-scale-factor=1',
        url,
      ]
    : [
        '--new-instance',
        '--profile',
        profile,
        `--remote-debugging-port=${port}`,
        `--width=${width + 40}`,
        `--height=${height + 140}`,
        '--new-window',
        url,
      ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let logs = '';

child.stderr.on('data', (data) => {
  logs += data;
});

const connections: WebSocket[] = [];
const notifications = new Map<string, (value: Reply) => void>();

type Reply = Record<string, any>;

const connect = async (url: string) => {
  const socket = new WebSocket(url);

  connections.push(socket);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let sequence = 0;

  const pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void }
  >();

  socket.addEventListener('close', () => {
    pending.forEach((request) =>
      request.reject(new Error('Owned browser connection closed')),
    );
    pending.clear();
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data as string);
    const request = pending.get(message.id);

    if (!request) {
      notifications.get(message.method)?.(message.params);
      notifications.delete(message.method);
      return;
    }

    pending.delete(message.id);

    if (message.error || message.type === 'error') {
      request.reject(new Error(JSON.stringify(message)));
    } else {
      request.resolve(message.result);
    }
  });

  return (method: string, params: object = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const id = ++sequence;

      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
};

try {
  let endpoint: string;

  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      browserName === 'firefox' &&
      logs.includes('WebDriver BiDi listening')
    ) {
      endpoint = `ws://127.0.0.1:${port}/session`;
      break;
    }

    if (browserName === 'chrome') {
      try {
        const pages = (await (
          await fetch(`http://127.0.0.1:${port}/json`)
        ).json()) as Reply[];

        endpoint = pages.find(
          (page) => page.type === 'page',
        )?.webSocketDebuggerUrl;

        if (endpoint) break;
      } catch {
        /* The isolated browser is still starting. */
      }
    }

    await pause(100);
  }

  assert(endpoint, logs);
  const send = await connect(endpoint);
  let context: string;
  let version: Reply;

  if (browserName === 'firefox') {
    version = await send('session.new', { capabilities: { alwaysMatch: {} } });
    const tree = await send('browsingContext.getTree');

    context = tree.contexts.find((context: Reply) =>
      context.url.includes('localhost:3000'),
    )?.context;
    assert(context);
    const { clientWindows } = await send('browser.getClientWindows');

    await send('browser.setClientWindowState', {
      clientWindow: clientWindows[0].clientWindow,
      state: 'normal',
      x: fullscreen ? 0 : 30,
      y: fullscreen ? 0 : 30,
      width: width + 40,
      height: height + 140,
    });

    if (fullscreen) {
      await send('browser.setClientWindowState', {
        clientWindow: clientWindows[0].clientWindow,
        state: 'fullscreen',
      });
    }

    await send('browsingContext.activate', { context });

    await send('browsingContext.setViewport', {
      context,
      viewport: { width, height },
      devicePixelRatio: 1,
    });
  } else {
    version = await send('Browser.getVersion');

    if (fullscreen) {
      const { windowId } = await send('Browser.getWindowForTarget');

      await send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'fullscreen' },
      });
    }

    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await send('Page.bringToFront');
  }

  await pause(5000);

  const evaluate = async (expression: string) => {
    const result =
      browserName === 'chrome'
        ? await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
        : await send('script.evaluate', {
            expression,
            awaitPromise: true,
            target: { context },
          });

    if (result.exceptionDetails || result.type === 'exception') {
      throw Error(JSON.stringify(result));
    }

    return result.result.value;
  };

  const action = (name: string) =>
    evaluate(`Reflect.get(window,'perf-capture')(${JSON.stringify(name)})`);

  const gpuInfo = JSON.parse(
    await evaluate(`(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'null';
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const info = [gl.getParameter(gl.VENDOR), gl.getParameter(gl.RENDERER),
      extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null];
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return JSON.stringify(info);
  })()`),
  );

  await evaluate(
    `(() => {const NativeAudio=AudioContext;window.AudioContext=class extends NativeAudio{constructor(...args){super(...args);Reflect.set(window,'perf-audio-context',this)}}})()`,
  );
  await evaluate(
    `(() => {const errors=[];Reflect.set(window,'perf-errors',errors);window.addEventListener('error',event=>{if(errors.length<3)errors.push(event.message + '\\n' + (event.error?.stack || ''))});window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)))})()`,
  );
  const setupInfo = JSON.parse(await action('setup'));

  await action('prepare');

  // A trusted unbound key uses the real audio unlock path without changing controls.
  if (browserName === 'chrome') {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'u',
        code: 'KeyU',
        windowsVirtualKeyCode: 85,
      });
    }
  } else {
    await send('input.performActions', {
      context,
      actions: [
        {
          type: 'key',
          id: 'performance-key',
          actions: [
            { type: 'keyDown', value: 'u' },
            { type: 'keyUp', value: 'u' },
          ],
        },
      ],
    });
  }

  const display = JSON.parse(
    await evaluate(
      `JSON.stringify({x:screenX,y:screenY,width:outerWidth,height:outerHeight,devicePixelRatio,screen:[screen.width,screen.height]})`,
    ),
  );
  const results: Reply[] = [];
  let stopping = false;

  process.on('SIGINT', () => {
    stopping = true;
  });

  const scenarios = process.env.GAMEPLAY_SCENARIOS?.split(',') || [
    'live',
    'large',
    'combat',
    'flight',
    'reference',
  ];

  for (const scenario of scenarios) {
    if (stopping) break;
    assert(
      ['live', 'combat', 'flight', 'large', 'reference'].includes(scenario),
    );

    if (scenario === 'reference') {
      await send(
        browserName === 'chrome' ? 'Page.navigate' : 'browsingContext.navigate',
        browserName === 'chrome'
          ? { url: 'about:blank' }
          : { context, url: 'about:blank', wait: 'complete' },
      );
      await pause(1000);
      const reference = await evaluate(`new Promise(resolve=>{
        document.body.style.cssText='margin:0;background:#102;overflow:hidden';
        const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};document.body.append(canvas);
        const ctx=canvas.getContext('2d',{alpha:false});
        const gaps=[],work=[];let start,before;
        const frame=now=>{const from=performance.now();ctx.clearRect(0,0,${width},${height});ctx.fillRect((now/10)%${width - 100},100,100,100);work.push(performance.now()-from);
          start??=now;if(before!==undefined)gaps.push(now-before);before=now;
          if(now-start<${seconds * 1000})requestAnimationFrame(frame);else {const sorted=gaps.toSorted((a,b)=>a-b),cpu=work.toSorted((a,b)=>a-b);
            resolve(JSON.stringify({scenario:'reference',fps:gaps.length*1000/gaps.reduce((a,b)=>a+b,0),frames:gaps.length,p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],missed:gaps.filter(value=>value>12.5).length,max:sorted.at(-1),cpu:[work.reduce((a,b)=>a+b,0)/work.length,cpu[Math.floor(cpu.length*.95)],cpu[Math.floor(cpu.length*.99)],cpu.at(-1)],viewport:[innerWidth,innerHeight],canvas:[canvas.width,canvas.height]}));}
        };requestAnimationFrame(frame);
      })`);
      const result = JSON.parse(reference);

      console.log(JSON.stringify(result, null, 2));
      results.push(result);
      continue;
    }

    await action(scenario === 'combat' ? 'fixture' : scenario);
    await pause(5000);

    if (process.env.GAMEPLAY_PROFILE && browserName === 'firefox') {
      await send('moz:profiler.start', {
        preset: 'firefox-platform',
        activeContext: context,
      });
    }

    if (process.env.GAMEPLAY_TRACE && browserName === 'chrome') {
      await send('Tracing.start', {
        categories:
          'devtools.timeline,v8,blink,cc,gpu,disabled-by-default-v8.gc',
        transferMode: 'ReturnAsStream',
        streamCompression: 'gzip',
      });
    }

    const raw = JSON.parse(await action('measure'));

    if (process.env.GAMEPLAY_TRACE && browserName === 'chrome') {
      const complete = new Promise<Reply>((resolve) =>
        notifications.set('Tracing.tracingComplete', resolve),
      );

      await send('Tracing.end');
      const { stream } = await complete;
      const chunks: Buffer[] = [];

      for (;;) {
        const part = await send('IO.read', { handle: stream });

        chunks.push(
          Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'),
        );

        if (part.eof) break;
      }

      await send('IO.close', { handle: stream });
      await mkdir(resolve(output, '..'), { recursive: true });
      await writeFile(
        output.replace(/\.json$/, `-${scenario}.trace.json.gz`),
        Buffer.concat(chunks),
      );
    }

    if (process.env.GAMEPLAY_PROFILE && browserName === 'firefox') {
      console.log(await send('moz:profiler.stop'));
    }

    const result = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key.replace(/^_/, ''), value]),
    );

    console.log(JSON.stringify({ scenario, ...result }, null, 2));
    assert.deepEqual(
      result['browser-errors'],
      [],
      'gameplay must render without browser errors',
    );
    assert.equal(
      result['surface-style-errors'],
      0,
      'world surfaces must have valid native CSS transforms',
    );
    assert.equal(
      result['background-style-errors'],
      0,
      'parallax layers must use native CSS transforms',
    );

    assert.deepEqual(result.viewport, [width, height]);
    assert.deepEqual(result.canvas, [width, height]);
    assert.equal(result.zoom, 1.5);

    if (process.env.GAMEPLAY_SOFTWARE || process.env.GAMEPLAY_GPU) {
      const attributes = result[
        'context-attributes'
      ] as CanvasRenderingContext2DSettings;

      assert.equal(
        attributes.willReadFrequently,
        Boolean(process.env.GAMEPLAY_SOFTWARE),
      );
    }

    assert(result.alive, 'the test must exercise a living ship');
    assert.equal(
      result['audio-state'],
      'running',
      'exercise normal unlocked audio',
    );

    if (scenario !== 'live') {
      assert(
        Number(result.rounds) > 0 &&
          Number(result.rounds) < 2000 &&
          (scenario !== 'combat' || Number(result.splits) > 0) &&
          result['light-active'],
        'combat must consume real ammunition, split rocks and project its search light',
      );
    }

    if (scenario === 'live' || scenario === 'flight') {
      assert(
        Number(result.movement) > 100 &&
          Number(result['camera-movement']) > 100,
        'flight must move the ship and camera through space',
      );
    }

    if (scenario === 'flight') {
      assert(
        Number(result['field-wraps']) > 0 &&
          (result['visible-rocks'] as number[])[0] >= 4,
        'The moving camera must remain in the asteroid field throughout flight',
      );
    }

    results.push({ scenario, ...result });

    if (process.env.GAMEPLAY_SCREENSHOTS) {
      const capture =
        browserName === 'chrome'
          ? await send('Page.captureScreenshot', { format: 'png' })
          : await send('browsingContext.captureScreenshot', {
              context,
              origin: 'viewport',
            });

      await mkdir(resolve(output, '..'), { recursive: true });
      await writeFile(
        output.replace(/\.json$/, `-${scenario}.png`),
        Buffer.from(capture.data, 'base64'),
      );
    }
  }

  await mkdir(resolve(output, '..'), { recursive: true });

  await writeFile(
    output,
    JSON.stringify(
      {
        browser: browserName,
        version,
        display,
        setupInfo,
        seconds,
        productionTransforms: true,
        source: baseline || 'working-tree',
        rendererPreference,
        gpuInfo,
        simulationStep,
        diagnostics: {
          profiler: Boolean(process.env.GAMEPLAY_PROFILE),
          trace: Boolean(process.env.GAMEPLAY_TRACE),
          softwareCanvas: Boolean(process.env.GAMEPLAY_SOFTWARE),
          gpuCanvas: Boolean(process.env.GAMEPLAY_GPU),
          sourceOverInterior: Boolean(process.env.GAMEPLAY_NO_LIGHTEN),
        },
        snapshotNote:
          'Live uses normal networking; combat and flight use the isolated deterministic client world.',
        results,
      },
      null,
      2,
    ),
  );

  if (browserName === 'firefox') {
    if (process.env.MOZ_PROFILER_SHUTDOWN) {
      await send('browser.close');
    } else {
      await send('session.end');
    }
  }
} finally {
  connections.forEach((socket) => socket.close());

  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }

  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });

  await rm(directory, { recursive: true, force: true });
}
