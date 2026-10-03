// Live adaptation of remote-browser.mjs: same CDP/context lifecycle, real canvas
// clients, frame measurements and gzip evidence; no local game server needed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { rolldown } from 'rolldown';
import { installLiveProbe } from './live-browser-probe.mjs';
import { liveSuite, runLiveSuite } from './live-suite.mjs';

const date = new Date().toISOString();
const output =
  process.argv[2] ||
  join('benchmarking/local', date.replaceAll(':', '-') + '.json.gz');
const url = process.env.BENCH_URL || 'https://unicorn-mining.co/';
const { counts, workloads, viewport, cooldownBetweenCounts } = liveSuite;
const { width, height } = viewport;
const seconds = Number(process.env.BENCH_SECONDS || 60);
const warmup = Number(process.env.BENCH_WARMUP || 15);

assert(
  Number.isFinite(seconds) &&
    seconds > 0 &&
    Number.isFinite(warmup) &&
    warmup >= 0,
  'Measurement must be positive and warmup nonnegative, in finite seconds',
);
const profile = await mkdtemp(join(tmpdir(), 'unicorn-live-benchmark-'));
const connections = [];
const results = [];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let chrome,
  chromeErrors = '',
  browser;
const metadata = {
  date,
  url,
  counts,
  workloads,
  seconds,
  warmup,
  cooldownBetweenCounts,
  cooldowns: [],
  viewport,
  headless: true,
  node: process.version,
  processor: cpus()[0]?.model,
  logicalCpus: cpus().length,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  runnerHash: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .update(
      await readFile(new URL('./live-browser-probe.mjs', import.meta.url)),
    )
    .update(await readFile(new URL('./live-suite.mjs', import.meta.url)))
    .digest('hex'),
  serverCpu:
    'Not exposed by the public endpoints; tick cadence and input acknowledgement delay are indirect pressure indicators.',
};
const save = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    gzipSync(JSON.stringify({ ...metadata, results }, null, 2) + '\n', {
      level: 9,
    }),
  );
};

// CDP connection and evaluation follow the existing remote-browser runner.
const connect = async (url, onEvent = () => {}) => {
  const socket = new WebSocket(url);

  await new Promise((done, reject) => {
    socket.once('open', done);
    socket.once('error', reject);
  });
  const pending = new Map();
  let sequence = 0;

  socket.on('message', (data) => {
    const message = JSON.parse(data);

    if (message.method) onEvent(message);
    const request = pending.get(message.id);

    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);

    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  connections.push(socket);
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);

      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
};
const evaluate = async (send, expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        JSON.stringify(result.exceptionDetails),
    );
  }
  return result.result.value;
};
const distribution = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!sorted.length) {
    return { count: 0, mean: null, p50: null, p95: null, max: null };
  }
  return {
    count: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};
const hostCpu = async () => {
  const values = (await readFile('/proc/stat', 'utf8'))
    .split('\n')[0]
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);

  return {
    total: values.slice(0, 8).reduce((a, b) => a + b, 0),
    idle: values[3] + values[4],
  };
};
const performanceMetrics = async (send) =>
  Object.fromEntries(
    (await send('Performance.getMetrics')).metrics.map(({ name, value }) => [
      name,
      value,
    ]),
  );

try {
  const html = await (await fetch(url)).text();
  const entryUrl = new URL(html.match(/<script[^>]+src="([^"]+)"/)[1], url)
    .href;
  const source = await (await fetch(entryUrl)).text();
  const socketAt = source.indexOf('new WebSocket(');

  assert(socketAt >= 0, 'Cannot locate the live network constructor');
  const applied = source.match(
    /\w+\(\{message:(\w+)(?:,[^}]*)?\}\)\{this\.(\w+)=\1\.\w+/,
  );

  assert(applied, 'Cannot identify the client snapshot clock');
  const world = source.match(
    new RegExp(`this\\.(\\w+)\\.(\\w+)=this\\.${applied[2]}(?:[,;})])`),
  );

  assert(world, 'Cannot identify the client simulation clock');
  const clockFields = { world: world[1], tick: world[2], applied: applied[2] };

  metadata.clockFields = clockFields;
  metadata.entryAsset = {
    url: entryUrl,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
  const beforeSocket = source.slice(0, socketAt).split('\n');
  const hookErrors = [];
  // Reuse the real shared decoders. The app still executes its own decoder.
  const bundle = await rolldown({
    input: 'live-protocol',
    plugins: [
      {
        name: 'live-protocol',
        resolveId(id) {
          if (id === 'live-protocol') return id;
        },
        load(id) {
          if (id !== 'live-protocol') return;
          return `import {decodeBinarySnapshot} from ${JSON.stringify(resolve('src/client/protocol/binary-snapshot.ts'))};
        import {decodeServerControl,decodeClientMessage} from ${JSON.stringify(resolve('src/client/protocol/binary-control.ts'))};
        globalThis.liveBenchmarkProtocol={decodeBinarySnapshot,decodeServerControl,decodeClientMessage};`;
        },
      },
    ],
  });
  const { output: compiled } = await bundle.generate({ format: 'iife' });

  await bundle.close();
  const initScript =
    compiled[0].code +
    `\n(${installLiveProbe.toString()})(${JSON.stringify(clockFields)});`;

  chrome = spawn(
    process.env.CHROME_BIN || 'google-chrome',
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  chrome.on('error', (error) => {
    chromeErrors += String(error);
  });
  chrome.stderr.on('data', (data) => {
    chromeErrors += data;
  });
  let version, endpoint;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const [port] = (
        await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
      ).split('\n');

      endpoint = `http://127.0.0.1:${port}`;
      version = await (await fetch(endpoint + '/json/version')).json();
      break;
    } catch {
      await pause(100);
    }
  }
  assert(version, chromeErrors);
  metadata.browser = version.Browser;
  browser = await connect(version.webSocketDebuggerUrl);

  await runLiveSuite({
    runCase: async ({ players, workload }) => {
      const contexts = [],
        clients = [],
        assets = new Map();
      const transports = [];
      let measuringTransport = false;
      const startedAt = new Date().toISOString();

      console.log(`${startedAt}: joining ${players} players / ${workload}`);

      try {
        for (let index = 0; index < players; index++) {
          transports[index] = [];
          const { browserContextId } = await browser(
            'Target.createBrowserContext',
          );

          contexts.push(browserContextId);
          const { targetId } = await browser('Target.createTarget', {
            url: 'about:blank',
            browserContextId,
            newWindow: true,
          });
          const pages = await (await fetch(endpoint + '/json')).json();
          const send = await connect(
            pages.find((page) => page.id === targetId).webSocketDebuggerUrl,
            (event) => {
              if (
                measuringTransport &&
                event.method === 'Network.webSocketFrameReceived' &&
                event.params.response.opcode === 2
              ) {
                const bytes = Buffer.from(
                  event.params.response.payloadData,
                  'base64',
                );

                if (bytes[0] === 0x55 && bytes[1] === 0x4d) {
                  // Same snapshot header/varint reader used by session.ts.
                  let tick = 0,
                    place = 1,
                    offset = 4,
                    part;

                  do {
                    part = bytes[offset++];
                    tick += (part & 127) * place;
                    place *= 128;
                  } while (part & 128);
                  transports[index].push({
                    at: event.params.timestamp * 1000,
                    tick,
                    bytes: bytes.length,
                  });
                }
              }

              if (event.method !== 'Debugger.paused') return;
              (async () => {
                await send('Debugger.evaluateOnCallFrame', {
                  callFrameId: event.params.callFrames[0].callFrameId,
                  expression: 'globalThis.liveBenchmark.network=this',
                });
                await send('Debugger.resume');
                await send('Debugger.disable');
              })().catch((error) => hookErrors.push(String(error)));
            },
          );

          await send('Runtime.enable');
          await send('Page.enable');
          await send('Performance.enable');
          await send('Network.enable');
          await send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await send('Page.addScriptToEvaluateOnNewDocument', {
            source: initScript,
          });
          // Expose this instance once during startup through a debugger scope;
          // the served app bytes remain unchanged and debugging stops before warmup.
          await send('Debugger.enable');
          await send('Debugger.setBreakpointByUrl', {
            url: entryUrl,
            lineNumber: beforeSocket.length - 1,
            columnNumber: beforeSocket.at(-1).length,
          });
          await send('Page.navigate', { url });
          clients.push(send);
        }
        let states;

        for (let attempt = 0; attempt < 180; attempt++) {
          states = await Promise.all(
            clients.map((send) =>
              evaluate(send, 'globalThis.liveBenchmark?.state()'),
            ),
          );

          if (states.every((state) => state?.ready)) break;
          await pause(500);
        }
        assert(
          states.every((state) => state?.ready),
          'All players must connect and receive their ships',
        );
        assert.equal(
          new Set(states.map((state) => state.shipId)).size,
          players,
          'Each player must have an independent identity',
        );
        assert.equal(hookErrors.length, 0, hookErrors.join('\n'));
        assert(
          states.every((state) => state.clock),
          'Every rendered client must expose its simulation clock',
        );
        // Hash fetched script bodies to identify the exact deployed release.

        for (const resource of await evaluate(
          clients[0],
          "performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script').map(e=>e.name)",
        )) {
          const response = await fetch(resource);

          assert(response.ok, `Asset fetch failed: ${resource}`);
          const body = Buffer.from(await response.arrayBuffer());

          assets.set(resource, {
            url: resource,
            bytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
          });
        }
        const graphics = await evaluate(
          clients[0],
          `(()=>{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null})()`,
        );
        const drive = async (duration) => {
          const began = performance.now();
          let previous = began;
          const schedulerGaps = [];

          while (performance.now() - began < duration * 1000) {
            const at = performance.now();

            schedulerGaps.push(at - previous);
            previous = at;
            const peers = states.map(
              (state) =>
                state.own && { id: state.own.id, position: state.own.position },
            );

            states = await Promise.all(
              clients.map((send, index) =>
                evaluate(
                  send,
                  `liveBenchmark.control(${JSON.stringify({ workload, index, players, peers, elapsed: (at - began) / 1000 })})`,
                ),
              ),
            );
            await pause(Math.max(0, 250 - (performance.now() - at)));
          }
          return schedulerGaps.slice(1);
        };

        await drive(warmup);
        await Promise.all(
          clients.map((send) => evaluate(send, 'liveBenchmark.start()')),
        );
        measuringTransport = true;
        const beforeCpu = await hostCpu();
        const beforeMetrics = await Promise.all(
          clients.map(performanceMetrics),
        );
        const measuredAt = new Date().toISOString();

        console.log(
          `${measuredAt}: MEASUREMENT START / ${players} players / ${workload} / ${seconds}s / ${width}x${height}`,
        );
        const schedulerGaps = await drive(seconds);

        console.log(
          `${new Date().toISOString()}: MEASUREMENT END / ${players} players / ${workload}`,
        );
        const afterMetrics = await Promise.all(clients.map(performanceMetrics));
        const afterCpu = await hostCpu();

        measuringTransport = false;
        const captures = await Promise.all(
          clients.map((send) => evaluate(send, 'liveBenchmark.finish()')),
        );
        const summaries = captures.map((capture, index) => {
          const duration = (capture.end - capture.start) / 1000;
          const snapshots = capture.snapshots;
          const first = snapshots[0],
            last = snapshots.at(-1);
          const snapshotDuration = (last?.at - first?.at) / 1000;
          const frame = distribution(capture.frames);

          return {
            client: index + 1,
            shipId: capture.shipId,
            duration,
            fps:
              (frame.count * 1000) / capture.frames.reduce((a, b) => a + b, 0),
            frameMs: frame,
            framesOver50Ms: capture.frames.filter((ms) => ms > 50).length,
            snapshotHz: (snapshots.length - 1) / snapshotDuration,
            serverTickHz: (last?.tick - first?.tick) / snapshotDuration,
            snapshotGapMs: distribution(snapshots.map((value) => value.gap)),
            gapsOver250Ms: snapshots.filter((value) => value.gap > 250).length,
            gapsOver1000Ms: snapshots.filter((value) => value.gap > 1000)
              .length,
            inputAckMs: distribution(
              capture.acknowledgements.map((value) => value.ms),
            ),
            inputLeadTicks: distribution(snapshots.map((value) => value.lead)),
            pendingInputs: capture.pendingInputs,
            downloadKiBs: capture.receivedBytes / 1024 / duration,
            uploadKiBs: capture.sentBytes / 1024 / duration,
            browserTaskPercent:
              ((afterMetrics[index].TaskDuration -
                beforeMetrics[index].TaskDuration) /
                duration) *
              100,
            heapMiB: afterMetrics[index].JSHeapUsedSize / 1024 ** 2,
            probeDecodeMs: distribution(capture.decodeCosts),
            closestPeer: capture.closestPeer,
            nearPeerSamples: capture.nearPeerSamples,
            stateSamples: capture.stateSamples,
            respawns: capture.respawns,
            healthDrops: capture.healthDrops,
            asteroidHealthDrops: capture.asteroidHealthDrops,
            travel:
              capture.ownSamples.length > 1
                ? Math.hypot(
                    capture.ownSamples.at(-1).position.x -
                      capture.ownSamples[0].position.x,
                    capture.ownSamples.at(-1).position.y -
                      capture.ownSamples[0].position.y,
                  )
                : null,
            dockedSamples: capture.ownSamples.filter((value) => value.dockedTo)
              .length,
            errors: capture.errors.length,
            transportGapMs: distribution(
              transports[index]
                .slice(1)
                .map((value, i) => value.at - transports[index][i].at),
            ),
            unappliedTicks: distribution(
              capture.ownSamples.map((value) => value.clock?.unappliedTicks),
            ),
            predictionLeadTicks: distribution(
              capture.ownSamples.map(
                (value) => value.clock?.predictionLeadTicks,
              ),
            ),
            closes: capture.closes.length,
          };
        });
        const result = {
          players,
          workload,
          startedAt,
          measuredAt,
          endedAt: new Date().toISOString(),
          assets: [...assets.values()],
          graphics,
          worldSeeds: states.map((state) => state.worldSeed),
          hostCpuBusyPercent:
            (1 -
              (afterCpu.idle - beforeCpu.idle) /
                (afterCpu.total - beforeCpu.total)) *
            100,
          controllerGapMs: distribution(schedulerGaps),
          summaries,
          captures,
          transports,
        };

        results.push(result);
        await save();
        console.log(
          JSON.stringify({
            players,
            workload,
            tickHz: distribution(summaries.map((value) => value.serverTickHz))
              .p50,
            fps: distribution(summaries.map((value) => value.fps)).p50,
            ackP95: distribution(summaries.map((value) => value.inputAckMs.p95))
              .p50,
            hostCpu: result.hostCpuBusyPercent,
          }),
        );
      } finally {
        for (const browserContextId of contexts) {
          await browser('Target.disposeBrowserContext', { browserContextId });
        }
      }
    },
    cooldown: async ({ seconds, previousPlayers, nextPlayers }) => {
      const startedAt = new Date().toISOString();

      console.log(
        `${startedAt}: COOLDOWN START / ${previousPlayers} → ${nextPlayers} players / ${seconds}s`,
      );
      await pause(seconds * 1000);
      const endedAt = new Date().toISOString();

      metadata.cooldowns.push({
        previousPlayers,
        nextPlayers,
        startedAt,
        endedAt,
      });
      await save();
      console.log(
        `${endedAt}: COOLDOWN END / joining ${nextPlayers} players next`,
      );
    },
  });
  metadata.completedAt = new Date().toISOString();
  await save();
} catch (error) {
  metadata.failure = String(error);
  await save();
  throw error;
} finally {
  connections.forEach((socket) => socket.close());

  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((done) => {
      chrome.once('exit', done);
      chrome.kill('SIGTERM');
    });
  }
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

// Publish tables after Chrome has stopped, without competing with measurement.
execFileSync(process.execPath, ['benchmarking/tools/live-report.mjs', output], {
  stdio: 'inherit',
});
console.log(`Scratch capture: ${output}`);
