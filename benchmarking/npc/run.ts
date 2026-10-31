import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { npcLanes, npcOverlay, parseNPCOptions } from './options.ts';
import { ProtocolClient } from '../server/client.ts';
import { limitServerCores } from '../server/cores.ts';
import { localServerPid, observeServerCpu } from '../server/observer.ts';
import { loadProtocolRuntime } from '../utilities/protocol-runtime.ts';
import {
  formatNPCCollection,
  readNPCReport,
  serializeNPCReport,
  summarizeNPCCollection,
} from './report.ts';
import { npcDocked, npcObservations } from './observations.ts';
import { openNPCBrowser, type NPCFrame } from './browser.ts';

const options = parseNPCOptions({ args: process.argv.slice(2) });

if (options.help) {
  console.log(
    'Usage: npm run benchmark:npc -- [--scenario all|NAME[,NAME]] [--cores 2] [--warmup 15] [--seconds 30] [--repetitions 3] [--concurrency 1] [--seed 1] [--watch] [--browser chrome] [--output PATH]',
  );
  console.log(
    'Scenarios: collector-empty, collector-idle, collector, collector-crowded-idle, collector-crowded, collection-courser, collection-finch. Default: all, without a browser.',
  );
  process.exit(0);
}

const { seconds, warmup, repetitions, scenarios } = options;

const displayNames: Record<string, string> = {
  'collector-empty': 'Collect empty',
  'collector-idle': 'Collect idle',
  collector: 'Collect active',
  'collector-crowded-idle': 'Crowd idle',
  'collector-crowded': 'Collect crowded',
  'collection-courser': 'Gather Courser',
  'collection-finch': 'Gather Finch',
};

const url = 'http://localhost:3000/';
const output = resolve(options.output);
const directory = await mkdtemp(join(tmpdir(), 'unicorn-npc-protocol-'));
const cancellation = new AbortController();
const interrupt = () =>
  cancellation.abort(new Error('NPC benchmark interrupted'));

process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const report = {
  benchmark: 'npc-behavior',
  startedAt: new Date().toISOString(),
  url,
  seconds,
  warmup,
  repetitions,
  concurrency: options.concurrency,
  measurement: null as null | {
    runs: number;
    serverCpu: Awaited<
      ReturnType<Awaited<ReturnType<typeof observeServerCpu>>['finish']>
    >;
    generator: {
      cpuPercentOfOneCore: number;
      rssBytes: number;
      eventLoopP99Ms: number;
      eventLoopMaxMs: number;
    };
  },
  seed: options.seed,
  scenarios,
  watch: options.watch,
  browser: null as
    | Awaited<ReturnType<typeof openNPCBrowser>>['metadata']
    | null,
  protocolRuntimeSha256: null as string | null,
  fixture: null as { directory: string; items: number } | null,
  setup:
    'A nonphysical view anchor streams the normal Go simulation without a player ship. Collection scenes use paired seeded layouts and stock hulls with the shared collector policy and Pilot. They end on docking or the capture limit; the five collector CPU scenes retain fixed windows. Concurrent collection cases use separate copies of the same sector. CPU and generator counters cover the continuous suite, including between-run preparation and finalization; they are not per-NPC costs. Watch mode mirrors each stream without another connection.',
  serverCores: null as
    | Awaited<ReturnType<typeof limitServerCores>>['metadata']
    | null,
  results: [] as {
    scenario: string;
    repetition: number;
    seed: number | null;
    authoritativeCollection: Awaited<ReturnType<typeof readNPCReport>> | null;
  }[],
  summary: [] as ReturnType<typeof summarizeNPCCollection>,
  complete: false,
  error: null as string | null,
};

let writes = Promise.resolve();

const save = () =>
  (writes = writes.then(async () => {
    report.summary = summarizeNPCCollection({
      scenarios,
      repetitions,
      results: report.results,
    });

    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serializeNPCReport(report, 2) + '\n');
  }));

let limits: Awaited<ReturnType<typeof limitServerCores>>;
const clients = new Set<ProtocolClient>();
let browser: Awaited<ReturnType<typeof openNPCBrowser>>;

try {
  let overlay: string;

  try {
    report.fixture = JSON.parse(
      await readFile(
        process.env.NPC_BENCHMARK_FIXTURE ||
          'benchmarking/_local/npc-fixture.json',
        'utf8',
      ),
    );
    assert(report.fixture && typeof report.fixture.directory === 'string');
    overlay = await realpath(resolve(report.fixture.directory, 'overlay.json'));
  } catch (error) {
    throw new Error(
      'The NPC benchmark fixture is missing or invalid. Run npm run benchmark:npc:prepare -- /tmp/unicorn-npc-benchmark first.\n' +
        (error instanceof Error ? error.message : JSON.stringify(error)),
    );
  }

  let pid: number;

  const restart = `GOMEMLIMIT=300MiB GOFLAGS=-overlay=${overlay} npm run dev:server`;

  try {
    pid = await localServerPid();
  } catch {
    throw new Error(
      `No local Go game server is listening on port 3001. Start the NPC fixture watcher:\n${restart}`,
    );
  }

  const environment = Object.fromEntries(
    (await readFile(`/proc/${pid}/environ`, 'utf8'))
      .split('\0')
      .filter((entry) => /^(GOMEMLIMIT|GOGC|GOFLAGS)=/.test(entry))
      .map((entry) => {
        const index = entry.indexOf('=');

        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );

  const setting = `GOMEMLIMIT=${environment.GOMEMLIMIT || '(unset)'}, GOGC=${environment.GOGC || '100 (default)'}`;
  const configured = npcOverlay(environment.GOFLAGS || '');
  const runningOverlay = configured
    ? await realpath(
        resolve(await readlink(`/proc/${pid}/cwd`), configured),
      ).catch((): string | null => null)
    : null;

  if (
    environment.GOMEMLIMIT !== '300MiB' ||
    (environment.GOGC ?? '100') !== '100' ||
    runningOverlay !== overlay
  ) {
    throw new Error(
      `Go server PID ${pid} on port 3001 is not configured for NPC benchmarks (${setting}; overlay=${configured || '(unset)'}). Stop its existing dev:server watcher before starting a replacement; two servers cannot share the world database. Then run:\n${restart}`,
    );
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });

    await response.body?.cancel();
    assert(response.ok);
  } catch {
    throw new Error(
      'The game frontend is unavailable on port 3000. Start npm run dev -- --strictPort in another terminal, keeping the NPC fixture watcher running.',
    );
  }

  limits = await limitServerCores({ pid, count: options.cores });
  report.serverCores = limits.metadata;
  const { runtime, runtimePath } = await loadProtocolRuntime(directory);

  report.protocolRuntimeSha256 = createHash('sha256')
    .update(await readFile(runtimePath))
    .digest('hex');

  if (options.watch) {
    browser = await openNPCBrowser({
      url,
      browser: options.browser,
      signal: cancellation.signal,
      pageCount: Math.min(options.concurrency, scenarios.length * repetitions),
    });

    report.browser = browser.metadata;
  }

  await save();

  const lanes = npcLanes(options);

  const barrier = Promise.withResolvers<void>();

  void barrier.promise.catch(() => {});

  let prepared = 0;
  let observer: Awaited<ReturnType<typeof observeServerCpu>>;
  let started: number;
  let cpuBefore: NodeJS.CpuUsage;
  const loop = monitorEventLoopDelay({ resolution: 10 });

  const startCapture = async () => {
    if (prepared < lanes.length && ++prepared === lanes.length) {
      observer = await observeServerCpu({
        url,
        pid: limits.metadata.pid,
        cpuIds: limits.metadata.logicalCpuIds,
      });

      started = performance.now();
      cpuBefore = process.cpuUsage();
      loop.enable();
      barrier.resolve();
    }

    await barrier.promise;
  };

  // Only the first cases synchronize their launch. Later cases start as soon as their window is free.
  const runCase = async (
    { scenario, repetition, seed }: (typeof lanes)[number]['queue'][number],
    lane: number,
  ) => {
    cancellation.signal.throwIfAborted();
    const collection = scenario.startsWith('collection-');

    console.error(
      `Preparing ${scenario}, repetition ${repetition}/${repetitions}${collection ? `, seed ${seed}` : ''}`,
    );

    const client = new ProtocolClient({
      url,
      index: lane,
      players: lanes.length,
      runtime,
      preparationTimeoutMs: 20000,
      displayName: displayNames[scenario],
    });

    clients.add(client);
    let watched: ReturnType<
      Awaited<ReturnType<typeof openNPCBrowser>>['attach']
    >;

    try {
      let docked: ReturnType<typeof npcDocked>;

      const receiveDock = (data: Buffer, binary: boolean) => {
        if (collection && binary && data[1] === 0x43) {
          try {
            docked ||= npcDocked(runtime.decodeServerControl(data));
          } catch (error) {
            client.errors.push(
              error instanceof Error ? error.message : JSON.stringify(error),
            );
          }
        }
      };

      client.socket.on('message', receiveDock);

      if (collection) {
        // The client's existing open handler sends Prepare first. Supply the
        // fixture seed before Welcome causes it to send Profile and Play.
        client.socket.once('open', () => {
          if (options.concurrency > 1) {
            client.send({
              type: 'chat',
              channel: 0,
              text: `/npc-benchmark-slot ${lane + 1}`,
            });
          }

          client.send({
            type: 'chat',
            channel: 0,
            text: `/npc-benchmark-seed ${seed}`,
          });
        });
      }

      watched = browser?.attach(client, {
        index: lane,
        scenario,
        repetition,
        repetitions,
        seed,
        targetName: collection
          ? `Collection ${scenario.slice('collection-'.length)}`
          : undefined,
      });

      await client.ready();
      await client.until(
        () => client.ship.name === `Fixture ${scenario}`,
        'Waiting for NPC compiler fixture',
      );
      await watched?.ready();
      await pause(warmup * 1000, undefined, { signal: cancellation.signal });
      await startCapture();

      const caseObserver =
        options.concurrency === 1
          ? await observeServerCpu({
              url,
              pid: limits.metadata.pid,
              cpuIds: limits.metadata.logicalCpuIds,
            })
          : null;

      client.start();
      const observations = npcObservations();

      const cameraFollow = watched
        ? {
            targetIDs: [] as number[],
            samples: 0,
            distance: 0,
            firstFrame: null as NPCFrame | null,
            lastFrame: null as NPCFrame | null,
          }
        : null;

      let lastWatchedFrame = 0;
      let lastViewAt = performance.now();

      let missingSince: number;

      let previousCamera: { x: number; y: number };

      const started = performance.now();
      const captureStart = Date.now();

      if (collection) {
        client.send({
          type: 'chat',
          channel: 0,
          text: '/npc-benchmark-start',
        });
      }

      while (!docked && performance.now() - started < seconds * 1000) {
        client.assertHealthy();
        const view = watched?.status();
        const frame = view?.lastFrame;
        const now = performance.now();
        const advanced = view && view.frames !== lastWatchedFrame;

        if (advanced) {
          lastWatchedFrame = view.frames;
          lastViewAt = now;
        }

        if (watched) {
          assert(
            now - lastViewAt < 5000,
            'The NPC browser stopped rendering frames for five seconds',
          );
        }

        if (frame?.targetID && (!frame.onScreen || !frame.inScene)) {
          missingSince ??= now;
          assert(
            now - missingSince < 1000,
            `NPC ${frame.targetID} is missing from the watched scene or camera viewport`,
          );
        } else {
          missingSince = undefined;
        }

        if (advanced && frame?.targetID && frame.onScreen && frame.inScene) {
          if (!cameraFollow.targetIDs.includes(frame.targetID)) {
            cameraFollow.targetIDs.push(frame.targetID);
            console.error(`Watching ${scenario}: NPC ${frame.targetID}`);
            previousCamera = undefined;
          }

          if (previousCamera) {
            cameraFollow.distance += Math.hypot(
              frame.camera.x - previousCamera.x,
              frame.camera.y - previousCamera.y,
            );
          }

          previousCamera = frame.camera;
          cameraFollow.firstFrame ||= frame;
          cameraFollow.lastFrame = frame;
          cameraFollow.samples++;
        }

        observations.observe({
          ships: [...client.entities.values()]
            .filter((ship) => ship.kind === 'ship' && ship.npcState)
            .map((ship) => ({
              id: ship.id,
              position: ship.position,
              cargo: ship.cargoContents?.length || 0,
              state: ship.npcState,
              visible: true,
            })),
        });

        await pause(100, undefined, { signal: cancellation.signal });
      }

      const ended = performance.now();
      const captureEnd = Date.now();
      const captureTick = client.tick;
      const endedBecause = docked ? 'docked' : 'timeout';
      const serverCpu = await caseObserver?.finish();

      client.socket.off('message', receiveDock);
      client.measuring = false;
      await watched?.close();
      watched = undefined;

      if (collection) {
        // Let normal docking sales/removal and snapshot receipts finish. This
        // is outside the measured trip and never keeps the watch page open.
        await client.until(
          () => client.tick > captureTick,
          'Waiting for the final NPC snapshot',
        );
      } else {
        await pause(1000, undefined, { signal: cancellation.signal });
      }

      const traffic = client.report(started, ended);
      const shipId = client.shipId;
      const worldSeed = client.worldSeed;

      if (
        cameraFollow &&
        (scenario.startsWith('collection-') ||
          scenario === 'collector' ||
          scenario === 'collector-crowded')
      ) {
        assert(
          cameraFollow.samples > 0,
          `Watch mode did not render an NPC during ${scenario}`,
        );
      }

      await client.close();
      clients.delete(client);

      const result = {
        scenario,
        repetition,
        seed,
        worldSeed,
        endedBecause,
        elapsedSeconds: (ended - started) / 1000,
        docked: docked || null,
        captureStart,
        captureEnd,
        lane: lane + 1,
        serverCpu: serverCpu || null,
        cameraFollow,
        npcs: observations.summary(),
        authoritativeCollection: null as Awaited<
          ReturnType<typeof readNPCReport>
        > | null,
        client: traffic,
      };

      report.results.push(result);
      await save();
      assert(
        traffic.snapshots > 0 &&
          traffic.errors.length === 0 &&
          !traffic.closedUnexpectedly,
        'The observer must stay healthy and receive snapshots',
      );
      assert.equal(
        traffic.receiptFailures + traffic.receiptWritesPending,
        0,
        'Snapshot receipts must finish successfully',
      );

      result.authoritativeCollection = await readNPCReport({
        shipId,
        scenario,
        start: captureStart,
        end: captureEnd,
        seed: collection ? seed : undefined,
      });

      if (docked) {
        assert(
          result.authoritativeCollection.captureEvents.some(
            (event) => event.kind === 'dock' && event.shipId === docked.id,
          ),
          'The trip must end on an authoritative docking event',
        );
      }

      if (collection) {
        const paired = report.results.find(
          (other) => other.scenario !== scenario && other.seed === seed,
        )?.authoritativeCollection;

        if (paired) {
          assert.deepEqual(
            result.authoritativeCollection.layout,
            paired.layout,
            `Collection seed ${seed} produced different layouts for the two hulls; world geometry changed between runs`,
          );
          const count = Math.min(
            result.authoritativeCollection.items,
            paired.items,
          );

          assert.deepEqual(
            result.authoritativeCollection.itemTypes.slice(0, count),
            paired.itemTypes.slice(0, count),
            `Collection seed ${seed} produced different mineral types for the two hulls`,
          );
        }
      }

      await save();

      console.log(
        serializeNPCReport({
          scenario,
          repetition,
          seed,
          endedBecause,
          elapsedSeconds: result.elapsedSeconds,
        }),
      );
    } finally {
      try {
        await watched?.close();
      } finally {
        await client.close();
        clients.delete(client);
      }
    }
  };

  const outcomes = await Promise.allSettled(
    lanes.map(async ({ queue }, lane) => {
      try {
        for (let job = queue.shift(); job; job = queue.shift()) {
          await runCase(job, lane);
        }
      } catch (error) {
        barrier.reject(error);
        cancellation.abort(error);

        for (const client of clients) client.socket.terminate();
        throw error;
      }
    }),
  );

  loop.disable();

  if (observer) {
    const ended = performance.now();
    const cpu = process.cpuUsage(cpuBefore);
    const serverCpu = await observer.finish();

    report.measurement = {
      runs: report.results.length,
      serverCpu,
      generator: {
        cpuPercentOfOneCore: (cpu.user + cpu.system) / 10 / (ended - started),
        rssBytes: process.memoryUsage().rss,
        eventLoopP99Ms: loop.percentile(99) / 1e6,
        eventLoopMaxMs: loop.max / 1e6,
      },
    };

    assert(serverCpu.available, 'The local Go CPU counter must be available');
  }

  await save();

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }

  report.complete = true;
} catch (error) {
  const failure = cancellation.signal.aborted
    ? cancellation.signal.reason
    : error;

  report.error =
    failure instanceof Error ? failure.message : JSON.stringify(failure);
  process.exitCode = /interrupted/.test(report.error) ? 130 : 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    ...[...clients].map((client) => client.close()),
    limits?.restore(),
  ]);

  for (const result of cleanup) {
    if (result.status === 'rejected') {
      report.complete = false;
      report.error ||= String(result.reason);
      process.exitCode ||= 1;
    }
  }

  if (report.error) {
    console.error(`NPC benchmark failed: ${report.error}`);
    console.error(`Report: ${output}`);
  }

  await save();
  await rm(directory, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}

if (report.summary.length) {
  console.log(
    `${report.complete ? 'Collection' : 'Partial collection'} summary; pickup times require all items, full-trip times also require docking:`,
  );

  console.log(formatNPCCollection(report.summary));
}

console.log(`Report: ${output}`);
