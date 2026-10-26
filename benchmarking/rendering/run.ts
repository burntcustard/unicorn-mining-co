import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { simulationStep } from '../../src/specs/simulation.ts';
import {
  setupGameplay,
  createGameplayWorkload,
  measureGameplay,
} from './workload.ts';
import { calibrateRefreshRate } from './frame-metrics.ts';
import { parseRenderingOptions } from './options.ts';
import { browserAction } from './browser-action.ts';
import { readBrowserJson } from './browser-http.ts';
import { stopOwnedChild } from '../utilities/owned-child.ts';

// Keep the standard development server pair running; this owns only its browser.
const options = parseRenderingOptions({
  args: process.argv.slice(2),
});

if (options.help) {
  console.log(
    'Usage: node benchmarking/rendering/run.ts [--browser chrome|firefox] [--scenario all|live|large|combat|flight|pirate] [--seconds 30] [--output PATH]',
  );
  process.exit(0);
}

const browserName = options.browser;
const seconds = options.seconds;
const output = options.output;
let width: number, height: number;

type Reply = Record<string, any>;

const readRetainedCombat = async (path: string) => {
  const deadline = Date.now() + 2000;

  for (;;) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Reply;
    } catch (error) {
      if (Date.now() >= deadline) throw error;

      await delay(100);
    }
  }
};

const root = process.cwd();
const directory = resolve(
  `benchmarking/_local/production-gameplay-${process.pid}`,
);
let stylesheets: string[] = [];
let profile: string;
let child: ChildProcess;
let logs = '';
let browserLaunchError: Error;
const connections: WebSocket[] = [];
const cancellation = new AbortController();

const interruptible = <Value>(operation: Promise<Value>) =>
  new Promise<Value>((resolve, reject) => {
    const { signal } = cancellation;
    const abort = () => reject(signal.reason);

    if (signal.aborted) {
      operation.catch(() => {});

      abort();

      return;
    }

    signal.addEventListener('abort', abort, { once: true });

    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });

const results: Reply[] = [];
const setupInfo: Reply[] = [];

const report: Reply = {
  startedAt: new Date().toISOString(),
  browser: browserName,
  seconds,
  scenarios: options.scenarios,
  productionTransforms: true,
  minified: !process.env.GAMEPLAY_PROFILE,
  source: 'working-tree',
  graphics: 'production defaults in a fresh temporary profile',
  stylesheets,
  simulationStep,
  diagnostics: {
    nativeDisplay: true,
    fullscreen: browserName === 'firefox' ? 'kiosk' : 'browser-window',
    profiler: Boolean(process.env.GAMEPLAY_PROFILE),
    trace: Boolean(process.env.GAMEPLAY_TRACE),
  },
  snapshotNote:
    'Live and pirate start fresh pages with normal Go networking. Large, combat, and flight reset isolated deterministic worlds in the running page.',
  setupInfo,
  results,
  validity: { pass: false },
};

let currentScenario: string;
let currentResult: Reply;

const interrupt = (signal: NodeJS.Signals) => {
  const reason = `Rendering capture interrupted by ${signal}`;

  report.interrupted = { signal, at: new Date().toISOString() };
  report.failure ||= { scenario: currentScenario ?? null, reason };
  report.validity = { pass: false };
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  cancellation.abort(new Error(reason));
};

const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');

process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);

try {
  stylesheets = (await readdir('dist'))
    .filter((name) => name.endsWith('.css'))
    .sort((a, b) => {
      const priority = (name: string) =>
        name.startsWith('index-') ? 0 : name.startsWith('docked-') ? 2 : 1;

      return priority(a) - priority(b);
    });

  report.stylesheets = stylesheets;
  assert(stylesheets.length, 'Build production CSS before measuring gameplay');

  assert(
    ['chrome', 'firefox'].includes(browserName),
    'Choose chrome or firefox',
  );
  assert(
    seconds > 0 && seconds <= 600,
    'Capture between 1 and 600 seconds per workload',
  );
  const pause = (milliseconds: number) =>
    delay(milliseconds, undefined, { signal: cancellation.signal });

  const readHostPower = async () => {
    const read = (path: string) =>
      readFile(path, 'utf8').then(
        (value) => value.trim(),
        (): null => null,
      );
    const [energyPreference, supplies] = await Promise.all([
      read(
        '/sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference',
      ),
      readdir('/sys/class/power_supply').catch((): string[] => []),
    ]);
    const online = Object.fromEntries(
      (
        await Promise.all(
          supplies
            .toSorted((left, right) => left.localeCompare(right, 'en-US'))
            .map(
              async (name) =>
                [
                  name,
                  await read(`/sys/class/power_supply/${name}/online`),
                ] as const,
            ),
        )
      ).filter(([, value]) => value !== null),
    );
    let profile: string = null;

    try {
      profile = execFileSync('powerprofilesctl', ['get'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim();
    } catch {
      /* Other platforms may not expose a power policy. */
    }

    return {
      at: new Date().toISOString(),
      policy: { profile, energyPreference, online },
    };
  };

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
    'protocol/input.ts',
    'effects/effect.ts',
    'effects/shrapnel.ts',
  ];
  // Compile the controller inside the src fixture so its properties and vector
  // exports receive the same production rewrites as the game it drives.
  const controls = (
    await readFile('benchmarking/rendering/pirate-controls.ts', 'utf8')
  ).replaceAll('../../src/', `${root}/src/`);
  const code = `
${modules.map((name, index) => `import * as m${index} from '${root}/src/client/${name}';`).join('\n')}
import * as itemSpecs from '${root}/src/specs/items/index.ts';
import * as simulation from '${root}/src/specs/simulation.ts';
${controls}
const modules = new Map([${modules.map((name, index) => `[${JSON.stringify(name)},m${index}]`).join(',')}, ['specs/items.ts',itemSpecs],['specs/simulation.ts',simulation]]);
const loadedGameModule = name => Promise.resolve(modules.get(name));
const {game}=m2, {network}=m1, {player}=m3;
const {camera}=m13;
let perfFixture;
Reflect.set(window, 'perf-capture', async action => {
  if(action==='/setup') return JSON.stringify(await (${setup}));
  if(action==='/prepare'){
    const start=performance.now();
    while(player.ship.dockedTo || player.ship.launching){
      if(performance.now()-start>10000) throw Error('The normal launch transition did not finish');
      m12.playerInput.launch=Boolean(player.ship.dockedTo);network.recordInput({input:m12.playerInput});
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    m12.playerInput.launch=false;network.recordInput({input:m12.playerInput});m4.ui.clear();
    return 'ready';
  }
  if(action==='/fixture'){await (${workload().replaceAll('window.perfFixture', 'perfFixture')});return 'fixture';}
  if(action==='/flight'){await (${workload(true).replaceAll('window.perfFixture', 'perfFixture')});return 'flight';}
  if(action==='/large'){await (${workload(false, true).replaceAll('window.perfFixture', 'perfFixture')});return 'large';}
  if(action==='/live'){
    const station=[...network.world.entities.values()].filter(object=>object.kind==='station').toSorted((a,b)=>Math.hypot(a.position.x-player.ship.position.x,a.position.y-player.ship.position.y)-Math.hypot(b.position.x-player.ship.position.x,b.position.y-player.ship.position.y))[0];
    if(!station)throw Error('The live rendering flight needs its normal nearby station');
    const heading=Math.atan2(player.ship.position.y-station.position.y,player.ship.position.x-station.position.x);
    const fromCamera={...camera};let aligned=false;
    const hold=()=>{
      const ship=player.ship, error=Math.atan2(Math.sin(heading-ship.rotation),Math.cos(heading-ship.rotation));
      aligned ||= Math.abs(error)<.03 && Math.abs(ship.spin)<.05;
      const steering=keyboardSteering({ship,angle:heading,thrust:aligned});
      const turn=aligned ? 0 : steering.turn;
      const thrust=steering.thrust;
      if(m12.playerInput.thrust!==thrust || m12.playerInput.turn!==turn || !m12.playerInput.searchLight){m12.playerInput.thrust=thrust;m12.playerInput.turn=turn;m12.playerInput.searchLight=true;network.recordInput({input:m12.playerInput});}
    };
    hold();
    if(!Reflect.get(window,'perf-live-input')){const original=network.updateFrame;network.updateFrame=options=>{hold();return original.call(network,options)};Reflect.set(window,'perf-live-input',true);}
    const started=performance.now();
    while(!aligned || Math.hypot(player.ship.velocity.x,player.ship.velocity.y)<100 || Math.hypot(camera.x-fromCamera.x,camera.y-fromCamera.y)<120){
      if(performance.now()-started>20000)throw Error('Normal outward flight did not move beyond the camera deadzone: '+JSON.stringify({aligned,position:player.ship.position,velocity:player.ship.velocity,rotation:player.ship.rotation,spin:player.ship.spin,fuel:player.ship.fuel,heading,camera,fromCamera}));
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return {heading,position:{...player.ship.position},velocity:{...player.ship.velocity},camera:{...camera}};
  }
  if(action==='/pirate'){
    const started=performance.now();
    while(![...network.world.entities.values()].some(object=>object.kind==='ship' && object.hostile && object.npcState==='Fighting')){
      if(performance.now()-started>15000)throw Error('Pirate rendering requires the local real-Go-NPC fixture; prepare benchmarking/rendering/pirate-fixture.ts and run the normal development server with its GOFLAGS overlay');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    let desired,lastThink=0;
    const hold=()=>{
      const now=performance.now(),ship=player.ship;
      if(!desired || now-lastThink>=100){
        lastThink=now;
        const entities=[...network.world.entities.values()];
        const enemies=entities.filter(object=>object.kind==='ship' && object.hostile && !object.dead).toSorted((a,b)=>Math.hypot(a.position.x-ship.position.x,a.position.y-ship.position.y)-Math.hypot(b.position.x-ship.position.x,b.position.y-ship.position.y));
        desired=pirateControls({ship,target:enemies[0],asteroids:entities.filter(object=>object.kind==='asteroid')});
      }
      if(!m14.sameInput(m12.playerInput,desired)){
        Object.assign(m12.playerInput,desired);
        network.recordInput({input:m12.playerInput});
      }
    };
    hold();
    const original=network.updateFrame;network.updateFrame=options=>{hold();return original.call(network,options)};
    return Object.fromEntries([['player-ship-id',network.shipId]]);
  }
  if(action==='/measure'){
    const result=await (${measureGameplay(seconds * 1000).replaceAll('window.perfFixture', 'perfFixture')});
    return JSON.stringify(Object.fromEntries([
      ['fps',result.fps],['frames',result.frames],['p95',result.p95],['p99',result.p99],['missed',result.missed],['max',result.max],['hidden-during-capture',result.hidden],
      ['late-frames',result.lateFrames],['refresh-rate',result.refreshRate],['frame-period-ms',result.framePeriod],
      ['fps-windows',result.fpsWindows],
      ['stalls',result.stalls],
      ['frame-work-ms',[result.frameWorkMs.mean,result.frameWorkMs.p95,result.frameWorkMs.p99,result.frameWorkMs.max]],
      ['update',[result.update.mean,result.update.p95,result.update.p99,result.update.max]],
      ['prediction',[result.prediction.mean,result.prediction.p95,result.prediction.p99,result.prediction.max]],
      ['messages',[result.messages.mean,result.messages.p95,result.messages.p99,result.messages.max]],['message-count',result.messageCount],
      ['viewport',result.viewport],['canvas',result.canvas],['zoom',result.zoom],['rounds',result.rounds],['alive',result.alive],
      ['context-attributes',game.ctx.getContextAttributes()],
      ['minimap-attributes',document.querySelector('.hud-map canvas').getContext('2d').getContextAttributes()],
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
      ['asteroids',game.sprites.filter(object=>object.kind==='asteroid').length],
      ['radar-contacts',network.asteroidPositions.length],
      ['rounds-used',result.roundsUsed],['pirate-samples',result.pirateSamples],['fighting-samples',result.fightingSamples],['pirate-firing-samples',result.pirateFiringSamples],['projectile-samples',result.projectileSamples],['pirate-movement',result.pirateMovement],['network-open',result.networkOpen]
      ,['pirate-projectile-samples',result.pirateProjectileSamples],['pirate-rounds-used',result.pirateRoundsUsed],['living-pirate-samples',result.livingPirateSamples]
      ,['ammunition-exhausted',result.ammunitionExhausted],['pirate-rounds-remaining',result.pirateRoundsRemaining]
      ,['prediction-diagnostics',result.predictionDiagnostics]
      ,['combatants',result.combatants],['capture-start-epoch-ms',result.captureStartedEpochMs],['capture-end-epoch-ms',result.captureEndedEpochMs]
    ]));
  }
  throw Error('Unknown rendering action: '+action);
});`;

  await Promise.all(
    ['http://localhost:3000/', 'http://localhost:3001/healthz'].map(
      async (url) => {
        assert(
          (await fetch(url, { signal: cancellation.signal })).ok,
          `Start the standard development services before testing: ${url}`,
        );
      },
    ),
  );

  const bundle = await rolldown({
    input: entry,
    onwarn(warning, emit) {
      if (
        ['IMPORT_IS_UNDEFINED', 'MISSING_EXPORT', 'UNRESOLVED_IMPORT'].includes(
          warning.code,
        )
      ) {
        throw new Error(warning.message);
      }

      emit(warning);
    },
    plugins: [
      {
        name: 'gameplay-performance',
        resolveId: (id) => (id === entry ? id : undefined),
        load: async (id) => {
          if (id === entry) return code;

          if (id.endsWith('?raw')) {
            return `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))}`;
          }

          if (id.endsWith('.css')) return { code: '', moduleType: 'js' };
        },
      },
      buildPrePlugin(),
      { ...buildPlugin(), generateBundle: undefined },
    ],
  });

  cancellation.signal.throwIfAborted();
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
    plugins: [buildPrePlugin()],
  });

  const { output: backgroundOutput } = await backgroundBundle.generate({
    format: 'iife',
    name: 'background',
    minify: true,
  });

  await backgroundBundle.close();
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheets.map((name) => `<link rel="stylesheet" href="/dist/${name}">`).join('')}</head><body><canvas id="background-canvas"></canvas><canvas id="canvas"></canvas><script>localStorage.removeItem('playerToken');${backgroundOutput[0].code}</script><script type="module" src="./fixture.js"></script></body></html>`,
  );

  const portProbe = createServer();

  await new Promise<void>((resolve) =>
    portProbe.listen(0, '127.0.0.1', resolve),
  );
  const address = portProbe.address();

  assert(address && typeof address !== 'string');
  const port = address.port;

  await new Promise<void>((resolve) => portProbe.close(() => resolve()));
  profile = await mkdtemp(join(tmpdir(), 'unicorn-gameplay-'));
  cancellation.signal.throwIfAborted();

  if (browserName === 'firefox') {
    await writeFile(
      join(profile, 'user.js'),
      `user_pref("browser.aboutwelcome.enabled", false);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n${process.env.GAMEPLAY_PROFILE ? `user_pref("browser.download.folderList", 2);\nuser_pref("browser.download.dir", ${JSON.stringify(resolve('benchmarking/_local'))});\n` : ''}`,
    );
  }

  const url = `http://localhost:3000/benchmarking/_local/production-gameplay-${process.pid}/`;

  cancellation.signal.throwIfAborted();
  child = spawn(
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
          'about:blank',
        ]
      : [
          '--new-instance',
          '--kiosk',
          '--profile',
          profile,
          `--remote-debugging-port=${port}`,
          '--new-window',
          'about:blank',
        ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  child.stderr.on('data', (data) => {
    logs += data;
  });

  child.once('error', (error) => {
    browserLaunchError = error;
    logs += error.stack || error.message;
  });

  const notifications = new Map<string, (value: Reply) => void>();

  const connect = async (url: string) => {
    const socket = new WebSocket(url);

    connections.push(socket);

    await interruptible(
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      }),
    );

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
      interruptible(
        new Promise<Reply>((resolve, reject) => {
          const id = ++sequence;

          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method, params }));
        }),
      );
  };

  let endpoint: string;

  for (let attempt = 0; attempt < 100; attempt++) {
    if (browserLaunchError) throw browserLaunchError;

    if (
      browserName === 'firefox' &&
      logs.includes('WebDriver BiDi listening')
    ) {
      endpoint = `ws://127.0.0.1:${port}/session`;
      break;
    }

    if (browserName === 'chrome') {
      try {
        const pages = (await readBrowserJson({
          url: `http://127.0.0.1:${port}/json`,
          signal: cancellation.signal,
        })) as Reply[];

        endpoint = pages.find(
          (page) => page.type === 'page',
        )?.webSocketDebuggerUrl;

        if (endpoint) break;
      } catch {
        cancellation.signal.throwIfAborted();
        /* The isolated browser is still starting. */
      }
    }

    await pause(100);
  }

  assert(endpoint, logs);
  const send = await connect(endpoint);

  const networkPermission: Reply = {
    name: 'loopback-network',
    origin: new URL(url).origin,
    scope: 'temporary-profile-default-context',
  };

  report.networkPermission = networkPermission;
  let context: string;
  let version: Reply;

  if (browserName === 'firefox') {
    version = await send('session.new', { capabilities: { alwaysMatch: {} } });
    const tree = await send('browsingContext.getTree');

    context = (
      tree.contexts.find((value: Reply) => value.url === 'about:blank') ||
      tree.contexts[0]
    )?.context;
    assert(context);
    await send('browsingContext.activate', { context });

    try {
      await send('permissions.setPermission', {
        descriptor: { name: networkPermission.name },
        state: 'granted',
        origin: networkPermission.origin,
      });

      networkPermission.override = 'granted';
    } catch (error) {
      networkPermission.override = 'unsupported';
      networkPermission.diagnostic =
        error instanceof Error ? error.message : JSON.stringify(error);
    }
  } else {
    version = await send('Browser.getVersion');

    const browser = (await readBrowserJson({
      url: `http://127.0.0.1:${port}/json/version`,
      signal: cancellation.signal,
    })) as Reply;

    const sendBrowser = await connect(browser.webSocketDebuggerUrl);

    await sendBrowser('Browser.setPermission', {
      permission: { name: networkPermission.name },
      setting: 'granted',
      origin: networkPermission.origin,
    });

    networkPermission.override = 'granted';
    const { windowId } = await send('Browser.getWindowForTarget');

    await send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });

    await send('Page.bringToFront');
  }

  report.version = version;

  const bounded = <Value>(request: Promise<Value>) => {
    let timer: ReturnType<typeof setTimeout>;

    return Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Gameplay browser evaluation timed out')),
          seconds * 1000 + 20000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };

  const evaluate = async (expression: string) => {
    const result = await bounded(
      browserName === 'chrome'
        ? send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
        : send('script.evaluate', {
            expression,
            awaitPromise: true,
            target: { context },
          }),
    );

    if (result.exceptionDetails || result.type === 'exception') {
      throw Error(JSON.stringify(result));
    }

    return result.result.value;
  };

  const action = (name: string) => browserAction(evaluate, name);

  const idleIntervals = JSON.parse(
    await evaluate(`new Promise(resolve=>{
    const gaps=[];let previous;
    const sample=now=>{if(previous!==undefined)gaps.push(now-previous);previous=now;
      if(gaps.length<96)requestAnimationFrame(sample);else resolve(JSON.stringify(gaps));};
    requestAnimationFrame(sample);
  })`),
  );

  const refresh = calibrateRefreshRate({
    intervals: idleIntervals,
  });

  report.refresh = refresh;
  const refreshRate = refresh.refreshRate;

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

  report.gpuInfo = gpuInfo;

  const prepareScenario = async (scenario: string) => {
    if (setupInfo.length && !['live', 'pirate'].includes(scenario)) {
      setupInfo.push({ scenario });
      return;
    }

    const scenarioURL = `${url}?scenario=${encodeURIComponent(scenario)}&run=${Date.now()}`;

    await send(
      browserName === 'chrome' ? 'Page.navigate' : 'browsingContext.navigate',
      browserName === 'chrome'
        ? { url: scenarioURL }
        : { context, url: scenarioURL, wait: 'complete' },
    );
    const started = Date.now();

    for (;;) {
      try {
        if (
          await evaluate(
            `location.href===${JSON.stringify(scenarioURL)} && document.readyState==='complete' && typeof Reflect.get(window,'perf-capture')==='function'`,
          )
        ) {
          break;
        }
      } catch {
        /* Navigation replaces the prior page's execution context. */
      }

      assert(
        Date.now() - started < 20000,
        'Rendering fixture did not finish loading',
      );
      await pause(100);
    }

    await evaluate(`Reflect.set(window,'perf-refresh-rate',${refreshRate})`);
    const permissionStatus = await evaluate(
      `(async () => {try{return (await navigator.permissions.query({name:'loopback-network'})).state}catch{return 'unsupported'}})()`,
    );

    if (browserName === 'chrome') {
      assert.equal(
        permissionStatus,
        'granted',
        'The owned Chrome context must pregrant local network access',
      );
    }

    await evaluate(
      `(() => {const NativeAudio=AudioContext;window.AudioContext=class extends NativeAudio{constructor(...args){super(...args);Reflect.set(window,'perf-audio-context',this)}}})()`,
    );
    await evaluate(
      `(() => {const errors=[];Reflect.set(window,'perf-errors',errors);window.addEventListener('error',event=>{if(errors.length<3)errors.push(event.message + '\\n' + (event.error?.stack || ''))});window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)))})()`,
    );
    const info = JSON.parse(await action('setup'));

    setupInfo.push({ scenario, permissionStatus, ...info });

    await action('prepare');

    // The existing FPS key also uses the real trusted-key audio unlock path.
    if (browserName === 'chrome') {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'f',
          code: 'KeyF',
          windowsVirtualKeyCode: 70,
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
              { type: 'keyDown', value: 'f' },
              { type: 'keyUp', value: 'f' },
            ],
          },
        ],
      });
    }
  };

  const display = JSON.parse(
    await evaluate(
      `JSON.stringify({x:screenX,y:screenY,width:outerWidth,height:outerHeight,devicePixelRatio,screen:[screen.width,screen.height],viewport:[innerWidth,innerHeight]})`,
    ),
  );

  report.display = display;
  [width, height] = display.screen;
  assert.deepEqual(
    display.viewport,
    [width, height],
    'The benchmark must fill the current display without viewport emulation',
  );

  const scenarios = options.scenarios;

  for (const scenario of scenarios) {
    cancellation.signal.throwIfAborted();

    currentScenario = scenario;
    currentResult = undefined;
    assert(['live', 'combat', 'flight', 'large', 'pirate'].includes(scenario));

    await send(
      browserName === 'chrome'
        ? 'Page.bringToFront'
        : 'browsingContext.activate',
      browserName === 'chrome' ? {} : { context },
    );
    console.log(
      JSON.stringify({ starting: scenario, at: new Date().toISOString() }),
    );

    const powerBefore = await readHostPower();

    const recordResult = async (result: Reply) => {
      currentResult = result;
      results.push(result);
      result.validity = { pass: false, reason: 'validation-pending' };
      const powerAfter = await readHostPower();

      result.power = { before: powerBefore, after: powerAfter };
      assert.deepEqual(
        powerAfter.policy,
        powerBefore.policy,
        'Power policy changed during capture; repeat with stable power',
      );
    };

    await prepareScenario(scenario);
    setupInfo.at(-1).readiness = await action(
      scenario === 'combat' ? 'fixture' : scenario,
    );
    await pause(1000);

    if (process.env.GAMEPLAY_PROFILE && browserName === 'firefox') {
      await send('moz:profiler.start', {
        preset: 'firefox-platform',
        activeContext: context,
      });
    }

    if (process.env.GAMEPLAY_TRACE && browserName === 'chrome') {
      await send('Tracing.start', {
        categories:
          'devtools.timeline,v8,blink,cc,gpu,disabled-by-default-v8.gc,disabled-by-default-v8.cpu_profiler',
        transferMode: 'ReturnAsStream',
        streamCompression: 'gzip',
      });
    }

    const raw = JSON.parse(await action('measure'));

    const result = {
      scenario,
      ...Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
          key.replace(/^_/, ''),
          value,
        ]),
      ),
      raw,
    } as Reply;

    await recordResult(result);

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

    Object.assign(
      result,
      JSON.parse(
        await evaluate(`JSON.stringify({
          'hud-panels': document.querySelectorAll('.hud-widget').length,
          'hud-visible': [...document.querySelectorAll('.hud-widget')].filter(element => !element.hidden && getComputedStyle(element).position === 'absolute').length
        })`),
      ),
    );

    assert.equal(
      result['hidden-during-capture'],
      false,
      'Keep the owned benchmark page visible',
    );
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
    assert.equal(
      result['hud-visible'],
      result['hud-panels'],
      'all gameplay HUD panels must be visible with production styles',
    );

    assert(result.alive, 'the test must exercise a living ship');
    assert.equal(
      result['audio-state'],
      'running',
      'exercise normal unlocked audio',
    );

    if (['large', 'combat', 'flight', 'pirate'].includes(scenario)) {
      assert.equal(
        result['ammunition-exhausted'],
        false,
        'The armed capture exhausted its standard ammo pack; use a shorter duration',
      );
    }

    if (!['live', 'pirate'].includes(scenario)) {
      assert.equal(
        result['radar-contacts'],
        result.asteroids,
        'isolated radar contacts must come from the measured world',
      );
      assert(
        Number(result.rounds) >= 0 &&
          Number(result.rounds) < 200 &&
          Number(result['rounds-used']) > 0 &&
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

    if (scenario === 'pirate') {
      assert.equal(
        result['network-open'],
        true,
        'Pirate rendering must use the real Go server',
      );
      const combatants = result.combatants as Reply[];

      assert.equal(
        combatants.length,
        3,
        'The encounter must contain three real combatants',
      );
      assert.deepEqual(
        combatants
          .map((ship) => ship['ship-type'])
          .sort((a, b) => a.localeCompare(b)),
        ['Arrow', 'Courser', 'Mustang'],
      );

      for (const ship of combatants) {
        assert(
          ship['alive-samples'] === ship.samples,
          `Combatant ${ship['ship-type']} must stay alive`,
        );
        assert(
          ship.movement > 100 && ship['path-distance'] > 200,
          `Combatant ${ship['ship-type']} must fly through the field`,
        );
        assert(
          ship['firing-samples'] > 0,
          `Combatant ${ship['ship-type']} must actually fire`,
        );

        if (ship['ship-type'] !== 'Arrow') {
          assert(
            ship['rounds-used'] > 0 && ship['ammo-end'] > 0,
            `Combatant ${ship['ship-type']} must fire its finite normal ammunition`,
          );
          assert(
            ship['new-projectile-ids'].length > 0 &&
              ship['new-cooldown-cycles'] > 0,
            `Combatant ${ship['ship-type']} must produce new shots during capture`,
          );
        }
      }

      assert(Number(result['message-count']) > 0);
    }

    if (scenario === 'flight') {
      assert(
        Number(result['field-wraps']) > 0 &&
          (result['visible-rocks'] as number[])[0] >= 4,
        'The moving camera must remain in the asteroid field throughout flight',
      );
    }

    result.validity = { pass: true };
    console.log(JSON.stringify(result, null, 2));

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

  assert.equal(
    results.length,
    scenarios.length,
    'Rendering capture interrupted before all requested scenarios completed',
  );
  currentScenario = undefined;
  currentResult = undefined;
  cancellation.signal.throwIfAborted();
  report.validity = { pass: true };

  if (browserName === 'firefox') {
    if (process.env.MOZ_PROFILER_SHUTDOWN) {
      await send('browser.close');
    } else {
      await send('session.end');
    }
  }
} catch (error) {
  const failure = cancellation.signal.aborted
    ? cancellation.signal.reason
    : error;
  const reason =
    failure instanceof Error ? failure.message : JSON.stringify(failure);

  report.failure = {
    scenario: currentScenario ?? null,
    reason,
    stack: failure instanceof Error ? failure.stack : undefined,
  };

  report.validity = { pass: false };

  if (currentResult) {
    currentResult.validity = { pass: false, reason };
  }

  process.exitCode = report.interrupted
    ? report.interrupted.signal === 'SIGINT'
      ? 130
      : 143
    : 1;
  console.error(report.failure.stack || reason);
} finally {
  const cleanupErrors: string[] = [];

  for (const socket of connections) {
    try {
      socket.close();
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error ? error.message : JSON.stringify(error),
      );
    }
  }

  try {
    await stopOwnedChild({ child });
  } catch (error) {
    cleanupErrors.push(
      error instanceof Error ? error.message : JSON.stringify(error),
    );
  }

  const pirateResult = results.find((result) => result.scenario === 'pirate');

  if (pirateResult) {
    try {
      const manifest = JSON.parse(
        await readFile(
          'benchmarking/_local/rendering-pirate-fixture.json',
          'utf8',
        ),
      );
      const shipId = setupInfo.find((info) => info.scenario === 'pirate')
        .readiness['player-ship-id'];
      const path = join(manifest.directory, `combat-${shipId}.json`);
      const data = await readRetainedCombat(path);

      data.hits = (data.hits || []).map((hit: Reply) => ({
        at: hit.At,
        by: hit.By,
        targetId: hit.TargetID,
        damage: hit.Damage,
        weapon: hit.Weapon,
      }));

      const hits = data.hits.filter(
        (hit: Reply) =>
          hit.at >= pirateResult['capture-start-epoch-ms'] &&
          hit.at <= pirateResult['capture-end-epoch-ms'],
      );

      pirateResult.authoritativeCombat = {
        ...data,
        captureHits: hits,
        source: path,
      };

      const npcIds = (pirateResult.combatants as Reply[])
        .filter((ship) => ship.role !== 'player')
        .map((ship) => ship['ship-id']);

      assert(
        hits.some(
          (hit: Reply) =>
            npcIds.includes(hit.targetId) &&
            (pirateResult.combatants as Reply[]).some(
              (ship) => ship.role !== 'player' && ship['player-id'] === hit.by,
            ),
        ),
        'The two real NPCs must exchange weapon damage, rather than only circling the player',
      );

      for (const ship of pirateResult.combatants as Reply[]) {
        assert(
          hits.some(
            (hit: Reply) =>
              hit.by === ship['player-id'] && hit.targetId !== ship['ship-id'],
          ),
          `Combatant ${ship['ship-type']} must land an authoritative weapon hit on another combatant during capture`,
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : JSON.stringify(error);

      pirateResult.validity = { pass: false, reason };
      report.validity = { pass: false };
      report.failure ||= { scenario: 'pirate', reason };
      process.exitCode ||= 1;
    }
  }

  const removals = await Promise.allSettled([
    ...(profile
      ? [
          rm(profile, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          }),
        ]
      : []),
    rm(directory, { recursive: true, force: true }),
  ]);

  for (const result of removals) {
    if (result.status === 'rejected') {
      cleanupErrors.push(
        result.reason instanceof Error
          ? result.reason.message
          : JSON.stringify(result.reason),
      );
    }
  }

  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.validity = { pass: false };
    process.exitCode ||= 1;
  }

  report.finishedAt = new Date().toISOString();
  report.browserLogs = logs;

  try {
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}
