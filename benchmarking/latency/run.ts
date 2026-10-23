import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadLatencyAssets } from './assets.ts';
import { openLatencyBrowser } from './browser.ts';
import {
  calibrateClock,
  clockMapping,
  latencyDistribution,
  observerAverage,
  responseForTrial,
  type ClockCalibration,
  type ClockSample,
} from './metrics.ts';
import { latencyFireHoldMs, parseLatencyOptions } from './options.ts';
import { prepareLatencyClients } from './preparation.ts';
import { installLatencyShutdown } from './lifecycle.ts';
import { loadProtocolRuntime } from '../utilities/protocol-runtime.ts';
import { summarizeSnapshotTraffic } from '../utilities/snapshot-traffic-metrics.ts';

type Value = Record<string, any>;
const options = parseLatencyOptions(process.argv.slice(2));

if (options.help) {
  console.log(
    'Usage: node benchmarking/latency/run.ts [--url http://localhost:3000/] [--browser chrome|firefox] [--scenario steer|fire|both] [--trials 100] [--output PATH.json.gz] [--resolution 960x540]',
  );
  process.exit(0);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (message: string) => console.log(`[latency] ${message}`);
const directory = await mkdtemp(join(tmpdir(), 'unicorn-latency-catalog-'));

const report: Value = {
  schema: 1,
  suite: 'four-browser-input-and-remote-presentation',
  startedAt: new Date().toISOString(),
  options,
  design: {
    clients: 4,
    actor: 0,
    observers: [1, 2, 3],
    graphics: 'fresh-profile production defaults; no zoom override',
    client:
      'Existing checkout production dist with read-only binding exposure and observational hooks; normal chunks and normal WebSocket origin.',
    network:
      'Normal WebSocket; no artificial delay, loss, background traffic clients, or overload/recovery workload.',
    endpoints:
      'Trusted DOM keydown and normal application input send → local completed game draw, decoded cumulative authoritative acknowledgment, and each of three remote completed game draws. Steering uses actual craft draws; firing reports projectile and nontransparent muzzle draws separately.',
    serverApply:
      'ACK proves the server consumed the input by acknowledgedSequence; decoded receipt includes serverTick. Exact server-apply wall time is not observable and is not claimed.',
    completion:
      'End of actual game requestAnimationFrame callback, after presentFrame; this is submitted game draw completion, not physical display scanout.',
    statistics:
      'Nearest-rank p50/p95/p99 per observer and across per-trial means of exactly three observers. Three observations of one actor event are paired, not independent trials. Any missing observer makes that trial mean missing.',
    preparation:
      'Genuine public profile/play, flight controls, physical station docking, normal server-confirmed purchase/equip with exactly one 200-round ammunition item, and normal launch. Preparation controls may use recordInput; measured events use trusted browser key automation. Ammunition is never refilled; exhaustion before all requested fire trials finishes the partial capture as invalid.',
  },
};

let browser: Awaited<ReturnType<typeof openLatencyBrowser>>;
let closeBrowser: () => Promise<void>;

const shutdown = installLatencyShutdown({
  onInterrupt: (signal) => {
    report.interrupted = { signal, at: new Date().toISOString() };
    report.validity = { pass: false, failures: ['capture-interrupted'] };
    progress(
      `${signal}: saving the partial capture and closing owned browsers.`,
    );
  },
  cleanup: async () => {
    try {
      if (browser) {
        report.browser = {
          ...browser.metadata,
          interceptedAssets: browser.metadata.interceptedAssets(),
          logs: browser.metadata.logs(),
          automationErrors: browser.errors,
        };

        if (report.interrupted && !report.captures) {
          report.captureEnd ??= performance.now();
          let timer: ReturnType<typeof setTimeout>;

          try {
            report.partialCaptures = await Promise.race([
              Promise.allSettled(
                browser.pages.map((page) =>
                  page.evaluate('globalThis.latencyProbe?.finish()', {
                    timeoutMs: 750,
                    duringShutdown: true,
                  }),
                ),
              ),
              new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), 750);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
      }

      await closeBrowser?.();
    } catch (error) {
      report.cleanupFailure =
        error instanceof Error
          ? error.stack || error.message
          : JSON.stringify(error);

      report.validity = {
        pass: false,
        failures: ['owned-browser-cleanup-failed'],
      };

      process.exitCode = 1;
    }

    try {
      report.finishedAt = new Date().toISOString();
      await mkdir(dirname(options.output), { recursive: true });
      const json = JSON.stringify(report, null, 2);

      await writeFile(
        options.output,
        options.output.endsWith('.gz') ? gzipSync(json) : json,
      );
      progress(`Saved ${options.output}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});

try {
  progress(
    'Loading the existing production assets and normal protocol catalog.',
  );
  const production = await loadLatencyAssets();
  const { runtime } = await loadProtocolRuntime(directory);

  report.client = production.metadata;
  shutdown.signal.throwIfAborted();

  browser = await openLatencyBrowser({
    options,
    production,
    signal: shutdown.signal,
    registerClose: (close) => {
      closeBrowser = close;
    },
  });

  const { pages } = browser;

  const prepared = await prepareLatencyClients({
    pages,
    properties: production.properties,
    tags: production.tags,
    catalog: runtime.catalog,
    fire: options.scenario !== 'steer',
    trials: options.trials,
    timeoutMs: options.preparationTimeoutMs,
    progress,
  });

  report.preparation = prepared.preparation;
  report.permissions = await Promise.all(
    pages.map((page) =>
      page.evaluate(
        `Promise.all(['loopback-network','local-network','local-network-access','clipboard-read','notifications'].map(async name => {try{return {name,state:(await navigator.permissions.query({name})).state}}catch{return {name,state:'unsupported'}}}))`,
      ),
    ),
  );
  report.protocolCompatibility =
    'The ordinary production handshake and snapshot decoder completed on all four clients. The server does not announce a build version; observable protocol/decoder/socket errors invalidate the run.';

  for (const page of pages) {
    await page.activate();
    await page.key('keyDown', 'q');
    await page.key('keyUp', 'q');
  }

  await pause(2500);
  report.audio = await Promise.all(
    pages.map((page) =>
      page.evaluate(
        '__latencyAudio.map(context => ({state:context.state,sampleRate:context.sampleRate,currentTime:context.currentTime}))',
      ),
    ),
  );
  report.renderingBeforeProbe = await Promise.all(
    pages.map((page) =>
      page.evaluate(
        'new Promise(resolve => {const times=[];let finished=false;const frame=now=>{times.push(now);if(!finished)requestAnimationFrame(frame)};requestAnimationFrame(frame);setTimeout(()=>{finished=true;resolve({frames:times.length,durationMs:times.at(-1)-times[0],fps:(times.length-1)*1000/(times.at(-1)-times[0]),hidden:document.hidden})},2000)})',
      ),
    ),
  );
  await Promise.all(
    pages.map((page) =>
      page.evaluate(`latencyClient.install(${JSON.stringify(prepared.pilot)})`),
    ),
  );
  await pages[0].activate();

  if (options.scenario !== 'steer') {
    await pages[0].key('keyDown', 'a');
    await pages[0].key('keyUp', 'a');
  }

  await pause(2500);

  const calibrate = async () => {
    const calibrations: ClockCalibration[] = [];

    for (const page of pages) {
      const samples: ClockSample[] = [];
      const timerResolution = await page.evaluate(
        '(()=>{let last=performance.now(),minimum=Infinity;const end=last+8;for(let index=0;index<200000;index++){const now=performance.now();if(now>last)minimum=Math.min(minimum,now-last);last=now;if(now>=end)break}return Number.isFinite(minimum)?minimum:null})()',
      );

      assert(
        timerResolution !== null,
        'Browser timer precision could not be measured',
      );

      for (let index = 0; index < 20; index++) {
        const before = performance.now();
        const time = await page.evaluate('performance.now()');

        samples.push({ before, page: time, after: performance.now() });
      }

      calibrations.push(calibrateClock(samples, timerResolution));
    }

    return calibrations;
  };

  const clocksBefore = await calibrate();

  report.clockBefore = clocksBefore;
  const scenarios =
    options.scenario === 'both' ? ['steer', 'fire'] : [options.scenario];
  const trials: Value[] = [];

  report.trials = trials;
  const states = () =>
    Promise.all(
      pages.map((page) =>
        page.evaluate('latencyProbe.state()', { timeoutMs: 5000 }),
      ),
    );
  const initial = await states();

  assert(
    initial.every(
      (state) => state.connected && !state.hidden && state.pilotInView,
    ),
    `All four clients must visibly draw the actor before measurement: ${JSON.stringify(initial)}`,
  );
  report.captureStart = performance.now();

  for (const kind of scenarios) {
    progress(
      `Measuring ${options.trials} ${kind} trials with one actor and three observers.`,
    );

    for (let index = 0; index < options.trials; index++) {
      const began = performance.now();
      let ready = false;
      let before: Value[];

      do {
        before = await states();

        if (kind === 'fire' && before[0].ammunition <= 0) {
          report.ammunitionExhaustion = {
            at: performance.now(),
            completedFireTrials: index,
            requestedFireTrials: options.trials,
            remainingFireTrials: options.trials - index,
            ammunition: before[0].ammunition,
          };

          progress(
            `Ammunition exhausted after ${index}/${options.trials} fire trials; saving the partial capture without refilling.`,
          );
          break;
        }

        ready =
          before.every(
            (state) =>
              state.connected &&
              !state.hidden &&
              state.pilotInView &&
              state.settled,
          ) &&
          before[0].turn === 0 &&
          !before[0].fire &&
          (kind !== 'fire' ||
            (before[0].ready &&
              before.every((state) => state.visibleProjectiles === 0)));

        if (!ready) await pause(80);
      } while (!ready && performance.now() - began < options.trialReadinessMs);

      if (report.ammunitionExhaustion) break;

      const trial = {
        id: trials.length + 1,
        kind,
        direction: index % 2 ? 1 : -1,
        readiness: ready,
        readinessWaitMs: performance.now() - began,
        states: before,
      };

      await Promise.all(
        pages.map((page) =>
          page.evaluate(
            `latencyProbe.begin(${JSON.stringify({ id: trial.id, kind, direction: trial.direction })})`,
          ),
        ),
      );
      const button =
        kind === 'fire'
          ? ' '
          : trial.direction > 0
            ? 'ArrowRight'
            : 'ArrowLeft';

      await pages[0].key('keyDown', button);
      await pause(kind === 'fire' ? latencyFireHoldMs : 150);
      await pages[0].key('keyUp', button);
      await pause(300 + (index % 5) * 13);
      trials.push(trial);

      if ((index + 1) % 10 === 0 || index + 1 === options.trials) {
        progress(
          `${kind}: ${index + 1}/${options.trials}; readiness failures so far ${trials.filter((trial) => !trial.readiness).length}.`,
        );
      }
    }
  }

  await pause(1500);
  report.captureEnd = performance.now();
  const clocksAfter = await calibrate();
  const captures: Value[] = await Promise.all(
    pages.map((page) => page.evaluate('latencyProbe.finish()')),
  );
  const mappings = clocksBefore.map((before, index) =>
    clockMapping(before, clocksAfter[index]),
  );

  report.clock = mappings.map((mapping, index) => ({
    before: clocksBefore[index],
    after: clocksAfter[index],
    driftMs: mapping.drift,
    uncertaintyMs: mapping.uncertainty,
  }));

  const normalize = (value: any, map: (at: number) => number): any => {
    if (Array.isArray(value)) {
      return value.map((entry) => normalize(entry, map));
    }

    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        [
          'at',
          'completedAt',
          'createdAt',
          'handledAt',
          'startedAt',
          'finishedAt',
          'lastCompletedAt',
        ].includes(key) && typeof entry === 'number'
          ? map(entry)
          : normalize(entry, map),
      ]),
    );
  };

  const normalized = captures.map((capture, index) =>
    normalize(capture, mappings[index].map),
  );

  report.captures = captures;
  report.clockBasis =
    'Raw page captures use performance.now()/DOMHighResTimeStamp. Summary timestamps are mapped to Node performance.now() using pre/post minimum-RTT calibrations and linearly interpolated offset drift. Bounds include measured browser timer granularity and the full observed offset drift; cross-client bounds add actor and observer uncertainty.';

  const completed: Value[] = trials.map((trial, index) => {
    const actor = normalized[0];
    const edge = actor.edges.find(
      (edge: Value) => edge.trialId === trial.id && edge.type === 'keydown',
    );
    const endAt = normalized[0].trials[index + 1]?.at ?? report.captureEnd;
    const sent =
      edge &&
      actor.messages.find(
        (message: Value) =>
          message.type === 'input' &&
          message.trialId === trial.id &&
          message.at >= edge.at &&
          (trial.kind === 'fire'
            ? message.input?.fire
            : message.input?.turn === trial.direction),
      );
    const acknowledgment =
      sent &&
      actor.messages.find(
        (message: Value) =>
          ['snapshot', 'load'].includes(message.type) &&
          message.acknowledgedSequence >= sent.sequence &&
          message.at >= sent.at,
      );

    const responses = normalized.map((capture) =>
      edge
        ? responseForTrial({
            frames: capture.frames.filter(
              (frame: Value) => frame.pilotDraw && frame.inView,
            ),
            edgeAt: edge.at,
            endAt,
            trial: trial as { id: number; kind: string; direction: number },
            previousIds: capture.trials[index].previousIds,
          })
        : {
            missing: {
              ms: null as number | null,
              reason: 'missing-trusted-keydown',
            },
          },
    );

    const metrics =
      trial.kind === 'steer' ? ['steering'] : ['projectile', 'muzzle'];

    const endpoints = Object.fromEntries(
      metrics.map((metric) => {
        const values = responses.map(
          (response) =>
            Reflect.get(response, metric) || {
              ms: null,
              reason: 'missing-keydown',
            },
        );

        const fromSend = values.map((value) =>
          value.ms === null || !sent ? null : value.ms - (sent.at - edge.at),
        );

        return [
          metric,
          {
            keydownToLocalMs: values[0].ms,
            sendToLocalMs: fromSend[0],
            keydownToObserversMs: values.slice(1).map((value) => value.ms),
            sendToObserversMs: fromSend.slice(1),
            keydownToObserverAverageMs: observerAverage(
              values.slice(1).map((value) => value.ms),
            ),
            sendToObserverAverageMs: observerAverage(fromSend.slice(1)),
            reasons: values.map((value) => value.reason),
          },
        ];
      }),
    );

    return {
      ...trial,
      edgeAt: edge?.at,
      trusted: edge?.trusted === true,
      eventTimestampSane:
        edge &&
        edge.handledAt - edge.at >= -2 &&
        edge.handledAt - edge.at < 1000,
      inputSendMs: sent && edge ? sent.at - edge.at : null,
      sendToAuthoritativeAckMs: acknowledgment
        ? acknowledgment.at - sent.at
        : null,
      keydownToAuthoritativeAckMs:
        acknowledgment && edge ? acknowledgment.at - edge.at : null,
      inputSequence: sent?.sequence,
      acknowledgmentServerTick: acknowledgment?.serverTick,
      endpoints,
    };
  });

  report.completed = completed;

  report.summary = Object.fromEntries(
    scenarios.map((kind) => {
      const selected = completed.filter((trial) => trial.kind === kind);
      const metrics =
        kind === 'steer' ? ['steering'] : ['projectile', 'muzzle'];

      return [
        kind,
        {
          trials: selected.length,
          requestedTrials: options.trials,
          notRunTrials: options.trials - selected.length,
          readinessFailures: selected.filter((trial) => !trial.readiness)
            .length,
          untrustedOrMissingEdges: selected.filter(
            (trial) => !trial.trusted || !trial.eventTimestampSane,
          ).length,
          inputSendMs: latencyDistribution(
            selected.map((trial) => trial.inputSendMs),
          ),
          sendToAuthoritativeAckMs: latencyDistribution(
            selected.map((trial) => trial.sendToAuthoritativeAckMs),
          ),
          keydownToAuthoritativeAckMs: latencyDistribution(
            selected.map((trial) => trial.keydownToAuthoritativeAckMs),
          ),
          endpoints: Object.fromEntries(
            metrics.map((metric) => [
              metric,
              {
                keydownToLocalMs: latencyDistribution(
                  selected.map(
                    (trial) => trial.endpoints[metric].keydownToLocalMs,
                  ),
                ),
                sendToLocalMs: latencyDistribution(
                  selected.map(
                    (trial) => trial.endpoints[metric].sendToLocalMs,
                  ),
                ),
                observers: [0, 1, 2].map((observer) => ({
                  client: observer + 1,
                  keydownMs: latencyDistribution(
                    selected.map(
                      (trial) =>
                        trial.endpoints[metric].keydownToObserversMs[observer],
                    ),
                  ),
                  sendMs: latencyDistribution(
                    selected.map(
                      (trial) =>
                        trial.endpoints[metric].sendToObserversMs[observer],
                    ),
                  ),
                })),
                keydownToObserverAverageMs: latencyDistribution(
                  selected.map(
                    (trial) =>
                      trial.endpoints[metric].keydownToObserverAverageMs,
                  ),
                ),
                sendToObserverAverageMs: latencyDistribution(
                  selected.map(
                    (trial) => trial.endpoints[metric].sendToObserverAverageMs,
                  ),
                ),
              },
            ]),
          ),
        },
      ];
    }),
  );

  report.clients = normalized.map((capture, index) => {
    const frames = capture.frames.filter(
      (frame: Value) =>
        frame.completedAt >= report.captureStart &&
        frame.completedAt < report.captureEnd,
    );
    const gaps = frames
      .slice(1)
      .map(
        (frame: Value, index: number) =>
          frame.completedAt - frames[index].completedAt,
      );
    const duration = frames.at(-1)?.completedAt - frames[0]?.completedAt;

    return {
      client: index,
      role: index === 0 ? 'actor' : 'observer',
      averageFps: duration > 0 ? ((frames.length - 1) * 1000) / duration : 0,
      frameGapMs: latencyDistribution(gaps),
      hiddenFrames: frames.filter((frame: Value) => frame.hidden).length,
      actorDrawFraction: frames.length
        ? frames.filter((frame: Value) => frame.pilotDraw && frame.inView)
            .length / frames.length
        : 0,
      errors: capture.errors,
      sockets: capture.sockets,
      state: capture.state,
      traffic: summarizeSnapshotTraffic({
        messages: capture.messages,
        start: report.captureStart,
        end: report.captureEnd,
      }),
    };
  });

  const crossClockBounds = mappings
    .slice(1)
    .map((mapping) => mapping.uncertainty + mappings[0].uncertainty);
  const failures = [
    ...(report.ammunitionExhaustion
      ? ['ammunition-exhausted-before-requested-fire-trials-completed']
      : []),
    ...(report.audio.some(
      (contexts: Value[]) =>
        contexts.length === 0 ||
        contexts.some((context) => context.state !== 'running'),
    )
      ? ['normal-game-audio-not-running']
      : []),
    ...(crossClockBounds.some((bound) => bound > options.maxClockUncertainty)
      ? ['clock-uncertainty-exceeds-threshold']
      : []),
    ...(report.clients.some(
      (client: Value) => client.averageFps < options.minFps,
    )
      ? ['browser-frame-rate-below-threshold']
      : []),
    ...(report.clients.some(
      (client: Value) => client.hiddenFrames || client.actorDrawFraction < 0.99,
    )
      ? ['actor-not-continuously-visible-on-all-clients']
      : []),
    ...(report.clients.some(
      (client: Value) =>
        client.errors.length ||
        client.sockets.some(
          (socket: Value) => socket.errors || socket.closes.length,
        ),
    )
      ? ['runtime-or-socket-error']
      : []),
    ...(completed.some(
      (trial) =>
        !trial.readiness ||
        !trial.trusted ||
        !trial.eventTimestampSane ||
        trial.sendToAuthoritativeAckMs === null,
    )
      ? ['trial-readiness-input-or-ack-failure']
      : []),
    ...(browser.errors.length ? ['automation-or-interception-error'] : []),
  ];

  report.validity = {
    pass: failures.length === 0,
    failures,
    maximumCrossClientClockUncertaintyMs: Math.max(...crossClockBounds),
    crossClientClockUncertaintyMs: crossClockBounds,
    thresholds: {
      maxClockUncertaintyMs: options.maxClockUncertainty,
      minAverageFps: options.minFps,
      minVisibleActorFrameFraction: 0.99,
    },
    interpretation:
      'Inspect every endpoint missed count. Projectile misses can be valid immediate impacts; muzzle misses remain separate. Invalid runs are retained and must not be used as healthy-client latency comparisons.',
  };

  if (!report.validity.pass) process.exitCode = 1;

  progress(
    JSON.stringify({ validity: report.validity, summary: report.summary }),
  );
} catch (error) {
  report.failure =
    error instanceof Error
      ? error.stack || error.message
      : JSON.stringify(error);

  report.validity = {
    ...report.validity,
    pass: false,
    failures: [...(report.validity?.failures ?? []), 'capture-failed'],
  };

  process.exitCode = 1;
  console.error(report.failure);
} finally {
  try {
    await shutdown.close();
  } finally {
    shutdown.dispose();
  }
}
