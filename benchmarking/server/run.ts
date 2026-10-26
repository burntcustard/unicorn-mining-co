import assert from 'node:assert/strict';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, freemem, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect, promisify } from 'node:util';
import * as Vec from '../../src/client/utilities/vector.ts';
import { replication } from '../../src/specs/replication.ts';
import type { ProtocolClient } from './client.ts';
import { loadProtocolRuntime } from '../utilities/protocol-runtime.ts';
import {
  reserveMiningTargets,
  miningWorkingRadius,
  miningNavigationReserve,
  reserveSpreadCorridors,
  spreadCruiseSpeed,
  spreadCorridorLength,
  spreadLateralAllowance,
  playerCounts,
  workloadNames,
  weaponMeasurementLimit,
  type ProtocolWorkload,
  type MiningProposal,
  type MiningTarget,
  type SpreadCorridorProposal,
  type SpreadCorridor,
} from './workloads.ts';
import { localServerPid, observeServerCpu } from './observer.ts';
import { limitServerCores } from './cores.ts';
import { stopOwnedChild } from '../utilities/owned-child.ts';

const execute = promisify(execFile);

export const selectServerCpuCases = ({
  players,
  workload,
}: {
  players?: number;
  workload?: string;
}) => {
  assert(
    players === undefined ||
      playerCounts.includes(players as (typeof playerCounts)[number]),
    '--players must be 4, 8, 16, or 32',
  );
  assert(
    workload === undefined ||
      workloadNames.includes(workload as ProtocolWorkload),
    `--workload must be ${workloadNames.join(', ')}`,
  );
  return playerCounts
    .filter((count) => players === undefined || count === players)
    .flatMap((count) =>
      workloadNames
        .filter((name) => workload === undefined || name === workload)
        .map((name) => ({ players: count, workload: name })),
    );
};

type ClientResult = ReturnType<ProtocolClient['report']>;

export const validateProtocolCase = ({
  clients,
  seconds,
  workload,
  players,
}: {
  clients: ClientResult[];
  seconds: number;
  workload: ProtocolWorkload;
  players?: number;
}) => {
  const failures: string[] = [];
  const cadenceFailures: string[] = [];

  if (
    !clients.length ||
    (players !== undefined && clients.length !== players)
  ) {
    failures.push(
      `Expected ${players ?? 'at least one'} clients; received ${clients.length}`,
    );
  }

  for (const client of clients) {
    const label = `client ${client.index}`;

    if (client.snapshotsPerSecond < 29.5) {
      cadenceFailures.push(
        `${label}: snapshots ${client.snapshotsPerSecond.toFixed(2)} Hz < 29.5 Hz`,
      );
    }

    if (client.snapshots < seconds * 29.5) {
      cadenceFailures.push(
        `${label}: fewer than29.5 snapshots per requested measurement second`,
      );
    }

    if (!(client.snapshots > 0)) {
      failures.push(
        `${label}: no emitted snapshots were consumed inside the measurement`,
      );
    }

    if (
      client.requestedReceipts !== client.sentReceipts ||
      client.receiptFailures ||
      client.sentReceipts !== client.receiptWritesCompleted ||
      client.receiptWritesPending
    ) {
      failures.push(`${label}: a requested snapshot receipt was not sent`);
    }

    if (client.missingInputAcknowledgments) {
      failures.push(
        `${label}: ${client.missingInputAcknowledgments} inputs remain unacknowledged after the drain`,
      );
    }

    if (
      client.longestSnapshotSilenceMs > 100 ||
      client.longestSnapshotGapMs > 100
    ) {
      cadenceFailures.push(`${label}: snapshot gap exceeds100 ms`);
    }

    if (client.serverTickGap.max > 1) {
      cadenceFailures.push(
        `${label}: server tick states were coalesced or skipped`,
      );
    }

    if (client.errors.length || client.closedUnexpectedly) {
      failures.push(`${label}: protocol errors or an unexpected close`);
    }

    if (client.network?.bufferedBytesAtEnd > 0) {
      failures.push(
        `${label}: outgoing socket data remained buffered after the drain`,
      );
    }

    if (!client.shipAlive || client.deaths || client.missingShipSnapshots) {
      failures.push(`${label}: the player ship died or disappeared`);
    }

    if (client.loadoutIntact === false || client.missingModuleSnapshots) {
      failures.push(`${label}: a required fitted module was lost`);
    }

    if (workload === 'convoy' && !(client.activity.maximumDisplacement >= 20)) {
      failures.push(
        `${label}: ordinary flight did not move at least 20 world units during measurement`,
      );
    }

    if (
      workload === 'spread' &&
      !(
        client.activity.maximumDisplacement >= seconds * 20 &&
        client.activity.movingFraction >= 0.8
      )
    ) {
      failures.push(
        `${label}: spreading must move at least20 units per measurement second and sustain speed>=20 for at least80% of snapshots`,
      );
    }

    if (
      workload === 'spread' &&
      !(client.activity.maximumCorridorDeviation <= spreadLateralAllowance)
    ) {
      failures.push(
        `${label}: cruise left its reserved segment and ${spreadLateralAllowance}-unit capsule allowance`,
      );
    }

    if (
      workload === 'weapon' &&
      !(client.activity.weaponFlyout?.displacement >= 20)
    ) {
      failures.push(
        `${label}: ordinary preparation flyout did not move at least 20 world units`,
      );
    }

    if (
      workload === 'contact' &&
      !(
        client.activity.minimumPeerSurfaceGap !== null &&
        client.activity.minimumPeerSurfaceGap <= 30
      )
    ) {
      failures.push(
        `${label}: the paired ships never approached contact range`,
      );
    }

    if (workload === 'module') {
      if (
        !(
          Number.isFinite(client.activity.maximumMiningAnchorDistance) &&
          client.activity.maximumMiningAnchorDistance >= 0 &&
          client.activity.maximumMiningAnchorDistance < miningWorkingRadius
        )
      ) {
        failures.push(
          `${label}: the miner left its ${miningWorkingRadius}-unit working disk`,
        );
      }

      if (
        !(
          client.activity.drillFraction >= 0.8 &&
          client.activity.hatchFraction >= 0.9 &&
          client.activity.lightFraction >= 0.9
        )
      ) {
        failures.push(
          `${label}: powered drill duty fell below80% or hatch/light duty below90%`,
        );
      }

      if (
        !(
          client.activity.minimumAssignedAsteroidSurfaceGap !== null &&
          client.activity.minimumAssignedAsteroidSurfaceGap <= 50
        )
      ) {
        failures.push(
          `${label}: the assigned asteroid did not approach mining range`,
        );
      }

      if (
        !(
          client.activity.assignedAsteroidDamageChanges > 0 ||
          client.activity.ownMiningFractures?.length > 0
        )
      ) {
        failures.push(
          `${label}: neither assigned-asteroid damage nor a responsible-player own-cell fracture was observed`,
        );
      }
    }

    if (workload !== 'weapon' || client.weapon.kind === 'none') continue;

    if (
      !(
        client.weapon.activeFraction >= 0.9 &&
        client.weapon.firingFraction >= 0.9
      )
    ) {
      failures.push(
        `${label}: weapon activation or held firing fell below 90% of measured snapshots`,
      );
    }

    if (
      client.weapon.kind === 'autogun' &&
      !(
        client.weapon.ammoEnd < client.weapon.ammoStart &&
        client.weapon.fireCooldownStarts > 0 &&
        client.weapon.minimumAmmo > 0
      )
    ) {
      failures.push(
        `${label}: autogun firing/ammunition evidence is missing or ammunition ran out`,
      );
    }

    if (
      client.weapon.kind === 'plasmaAccelerator' &&
      !(client.weapon.fireCooldownStarts > 0)
    ) {
      failures.push(
        `${label}: no new plasma firing cycle was observed inside the measurement`,
      );
    }
  }

  if (
    workload === 'module' &&
    !clients.some(
      (client) =>
        client.activity.asteroidDamageChanges > 0 ||
        client.activity.ownMiningFractures?.length > 0,
    )
  ) {
    failures.push(
      'No visible asteroid damage changed while the module workload ran',
    );
  }

  return {
    valid: failures.length === 0,
    failures,
    serverCadence: {
      valid: cadenceFailures.length === 0,
      failures: cadenceFailures,
    },
  };
};

export const summarizeTickSkips = (
  clients: {
    index: number;
    serverTickSkips: {
      previousTick: number;
      serverTick: number;
      at: number;
      gapMs: number;
    }[];
  }[],
) => {
  const events = new Map<
    string,
    {
      previousTick: number;
      serverTick: number;
      clients: number[];
      receivedAt: number[];
      gapsMs: number[];
    }
  >();

  for (const client of clients) {
    for (const skip of client.serverTickSkips || []) {
      const key = `${skip.previousTick}:${skip.serverTick}`;

      const event = events.get(key) || {
        previousTick: skip.previousTick,
        serverTick: skip.serverTick,
        clients: [],
        receivedAt: [],
        gapsMs: [],
      };

      event.clients.push(client.index);
      event.receivedAt.push(skip.at);
      event.gapsMs.push(skip.gapMs);
      events.set(key, event);
    }
  }

  return [...events.values()].map((event) => ({
    ...event,
    sharedByAllClients: new Set(event.clients).size === clients.length,
  }));
};

type WorkerResult = {
  elapsedMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuPercentOfOneCore: number;
  rssBytes: number;
  eventLoopDelayMs: { p95: number; p99: number; max: number };
  inputTimerGapMs: { p99: number; max: number };
};

export async function beginProtocolCoreSetup<Limit>({
  findPid,
  limit,
}: {
  findPid: () => Promise<number>;
  limit: (pid: number) => Promise<Limit>;
}) {
  return limit(await findPid());
}

export async function finishInterruptedProtocolCapture({
  workers,
  restore,
  removeDirectory,
  save,
  report,
}: {
  workers: { close: () => Promise<void> }[];
  restore: () => Promise<unknown>;
  removeDirectory: () => Promise<unknown>;
  save: () => Promise<void>;
  report: { cleanupErrors: string[] };
}) {
  const record = (stage: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : inspect(error);

    report.cleanupErrors.push(`${stage}: ${reason}`);
  };

  const closed = await Promise.allSettled(
    workers.map((worker) => Promise.resolve().then(() => worker.close())),
  );

  for (const [index, result] of closed.entries()) {
    if (result.status === 'rejected') {
      record(`protocol worker ${index}`, result.reason);
    }
  }

  try {
    await restore();
  } catch (error) {
    record('restore server affinity', error);
  }

  try {
    await removeDirectory();
  } catch (error) {
    record('remove protocol temporary directory', error);
  }

  await save();
}

class ClientWorker {
  readonly indices: number[];
  readonly process: ChildProcess;
  readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  sequence = 0;
  exited = false;
  closing: Promise<void>;
  constructor(indices: number[]) {
    this.indices = indices;
    this.process = fork(
      fileURLToPath(new URL('./client.ts', import.meta.url)),
      ['--protocol-worker'],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );

    this.process.on(
      'message',
      (message: { id: number; error?: string; result?: unknown }) => {
        const pending = this.pending.get(message.id);

        if (!pending) return;
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      },
    );

    this.process.on('exit', (code, signal) => {
      this.exited = true;

      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Protocol worker exited ${code}, ${signal}`));
      }

      this.pending.clear();
    });

    this.process.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }
  command<Result = unknown>(
    command: string,
    extra: Record<string, unknown> = {},
  ): Promise<Result> {
    assert(!this.exited, 'Protocol worker has exited');
    const id = ++this.sequence;

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });

      this.process.send({ id, command, ...extra });
    });
  }
  close() {
    if (this.closing) return this.closing;

    this.closing = (async () => {
      if (this.exited) return;

      await Promise.race([
        this.command('close').catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      await stopOwnedChild({ child: this.process });
    })();

    return this.closing;
  }
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const hostCpu = async () =>
  (await readFile('/proc/stat', 'utf8'))
    .split('\n')[0]
    .split(/\s+/)
    .slice(1)
    .map(Number);

const hostUtilization = (before: number[], after: number[]) => {
  const deltas = after.map((value, index) => value - before[index]);
  // Linux guest time is already part of user/nice time.
  const total = deltas.slice(0, 8).reduce((sum, value) => sum + value, 0);

  return total > 0 ? 100 * (1 - (deltas[3] + deltas[4]) / total) : null;
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(
      'Usage: npm run benchmark:server:local -- [--cores N] [--players 4|8|16|32] [--workload convoy|spread|contact|module|weapon] [--seconds 30] [--warmup 15] [--prepare-timeout 600] [--repetitions 1] [--output FILE.json.gz]. Use benchmark:server:live for the deployed server; --cores applies only to the local Go server.',
    );
    return;
  }

  const allowed = [
    'target',
    'cores',
    'prepare-timeout',
    'players',
    'workload',
    'seconds',
    'warmup',
    'repetitions',
    'output',
  ];
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');

    assert(
      args[index].startsWith('--') &&
        allowed.includes(key) &&
        args[index + 1] !== undefined,
      `Unknown or incomplete option ${args[index]}`,
    );
    assert(parsed[key] === undefined, `Duplicate option --${key}`);
    parsed[key] = args[index + 1];
  }

  const target = parsed.target || 'local';

  assert(['local', 'live'].includes(target), '--target must be local or live');
  const local = target === 'local';
  const url = local ? 'http://localhost:3000/' : 'https://unicorn-mining.co/';

  const seconds = Number(parsed.seconds || 30);
  const warmup = Number(parsed.warmup ?? 15);
  const repetitions = Number(parsed.repetitions || 1);
  const prepareTimeout = Number(parsed['prepare-timeout'] || 600);
  const cores = parsed.cores === undefined ? undefined : Number(parsed.cores);

  assert(
    Number.isFinite(prepareTimeout) &&
      prepareTimeout > 0 &&
      prepareTimeout <= 600,
    '--prepare-timeout must be greater than0 and at most600 seconds',
  );
  assert(
    local || cores === undefined,
    '--cores limits only the local Go server; it never resizes a live machine',
  );

  assert(
    Number.isFinite(seconds) && seconds >= 5,
    '--seconds must be at least 5',
  );
  assert(
    Number.isFinite(warmup) && warmup >= 0,
    '--warmup must be nonnegative',
  );
  assert(
    Number.isInteger(repetitions) && repetitions >= 1,
    '--repetitions must be a positive integer',
  );

  const cases = selectServerCpuCases({
    players: parsed.players === undefined ? undefined : Number(parsed.players),
    workload: parsed.workload,
  });

  const cruiseSpeed = cases.some(
    (configuration) => configuration.workload === 'spread',
  )
    ? spreadCruiseSpeed(seconds)
    : undefined;

  const output = resolve(
    parsed.output ||
      `benchmarking/_local/server-cpu-${new Date().toISOString().replaceAll(':', '-')}.json.gz`,
  );
  const directory = await mkdtemp(join(tmpdir(), 'unicorn-protocol-'));
  const { runtime, runtimePath } = await loadProtocolRuntime(directory);
  const sourcePaths = ['src', 'plugins', 'vite.config.ts'];
  const benchmarkPaths = [
    'benchmarking/server/run.ts',
    'benchmarking/server/client.ts',
    'benchmarking/server/workloads.ts',
    'benchmarking/server/observer.ts',
    'benchmarking/server/cores.ts',
    'benchmarking/utilities/protocol-runtime.ts',
    'benchmarking/utilities/snapshot-traffic-metrics.ts',
    'benchmarking/utilities/ship-controls.ts',
    'benchmarking/utilities/owned-child.ts',
  ];
  const revision = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const sourceStatus = (
    await execute('git', [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...sourcePaths,
    ])
  ).stdout.trimEnd();
  const benchmarkStatus = (
    await execute('git', [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...benchmarkPaths,
    ])
  ).stdout.trimEnd();

  const checkout = {
    revision,
    dirtySource: !!sourceStatus,
    sourceStatus,
    sourcePaths,
    dirtyBenchmark: !!benchmarkStatus,
    benchmarkStatus,
    benchmarkPaths,
    benchmarkSha256: Object.fromEntries(
      await Promise.all(
        benchmarkPaths.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        ]),
      ),
    ),
    protocolRuntimeSha256: createHash('sha256')
      .update(await readFile(runtimePath))
      .digest('hex'),
    note: 'Checkout and generator identity; this does not assert that a separately running local or deployed server was built from this checkout. Archived-result cleanup is outside these status scopes.',
  };

  const report = {
    schema: 2,
    benchmark: 'server-cpu',
    createdAt: new Date().toISOString(),
    url,
    target,
    seconds,
    warmup,
    preparationTimeoutSeconds: prepareTimeout,
    serverCores: null as
      | Awaited<ReturnType<typeof limitServerCores>>['metadata']
      | null,
    repetitions,
    checkout,
    matrix: { playerCounts, workloads: workloadNames, selected: cases },
    setup:
      'Fresh hello identities with unretained session tokens, normal game-socket binary codecs and delta application; changed keyboard inputs only; immediate requested snapshot receipts. Weapon clients physically dock, buy/equip normally, buy one standard200-round item for each autogun, clear the station bay and fan out for10 seconds. Weapons activate/charge during nonfiring warmup; continuous firing is briefly confirmed immediately before measurement. An optional local core limit changes only the Go server affinity and is restored after the suite.',
    measurement:
      'Primary CPU uses matching machine busy-counter modes on both targets: selected local logical CPUs or the live Fly machine. Local measurements can include unrestricted load-generator or background processes; supplemental local Go-process CPU isolates the server. Hardware differs and no live process counter is available. Generator timings and traffic are application observations, not browser rendering or wire latency. Allocation counts are unavailable through the public game protocol. Failed cases are retained without reducing player count.',
    host: {
      platform: process.platform,
      node: process.version,
      cpus: cpus().length,
      availableParallelism: availableParallelism(),
      totalMemoryBytes: totalmem(),
      initialFreeMemoryBytes: freemem(),
    },
    results: [] as Record<string, unknown>[],
    complete: false,
    cleanupErrors: [] as string[],
    interrupted: null as { signal: string; at: string } | null,
    error: null as string | null,
  };

  const save = async () => {
    await mkdir(dirname(output), { recursive: true });
    const json = JSON.stringify(report, null, 2) + '\n';

    await writeFile(output, output.endsWith('.gz') ? gzipSync(json) : json);
  };

  let coreLimit: Awaited<ReturnType<typeof limitServerCores>>;
  let coreSetup: Promise<Awaited<ReturnType<typeof limitServerCores>>>;
  let activeWorkers: ClientWorker[] = [];
  let stopping = false;

  const interrupt = (signal: string) => {
    if (stopping) return;
    stopping = true;
    report.interrupted = { signal, at: new Date().toISOString() };

    void finishInterruptedProtocolCapture({
      workers: activeWorkers,
      report,
      restore: async () => {
        const limit =
          coreLimit ?? (await coreSetup?.catch((): undefined => undefined));

        await limit?.restore();
      },
      removeDirectory: () => rm(directory, { recursive: true, force: true }),
      save,
    })
      .catch((error) => console.error(error))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };

  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');

  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  try {
    if (local) {
      coreSetup = beginProtocolCoreSetup({
        findPid: localServerPid,
        limit: (pid) => limitServerCores({ pid, count: cores }),
      });

      coreLimit = await coreSetup;

      if (stopping) return;
      report.serverCores = coreLimit.metadata;
      await save();
    }

    for (const configuration of cases) {
      if (stopping) break;

      for (let repetition = 1; repetition <= repetitions; repetition++) {
        if (stopping) break;
        const label = `${configuration.players} players / ${configuration.workload} / ${repetition}`;

        console.error(`Preparing ${label}`);
        const workers: ClientWorker[] = [];

        activeWorkers = workers;
        let miningPreparation: Record<string, unknown>;
        let spreadPreparation: Record<string, unknown>;
        let preparationProgressTimer: ReturnType<typeof setInterval>;
        let preparationProgressOpen = false;

        try {
          if (configuration.workload === 'weapon') {
            const maximum = weaponMeasurementLimit({
              rounds: runtime.catalog.ammoRounds,
              fireInterval: runtime.catalog.modules.autogun.fireInterval,
            });

            assert(
              seconds <= maximum,
              `One ordinary ${runtime.catalog.ammoRounds}-round item supports at most ${maximum}s of measured continuous autogun fire with a 5-second confirmation/transport reserve. Shorten --seconds; additional ammunition is never purchased.`,
            );
          }

          const count = Math.ceil(configuration.players / 8);

          for (let worker = 0; worker < count; worker++) {
            if (stopping) break;
            const indices = Array.from(
              { length: Math.min(8, configuration.players - worker * 8) },
              (_, index) => worker * 8 + index,
            );

            workers.push(new ClientWorker(indices));
          }

          const options = {
            ...configuration,
            url,
            runtimePath,
            seconds,
            warmup,
            preparationTimeoutMs: prepareTimeout * 1000,
          };

          await Promise.all(
            workers.map((worker) =>
              worker.command('initialize', {
                options: { ...options, indices: worker.indices },
              }),
            ),
          );

          if (configuration.workload === 'weapon') {
            // Serial approaches avoid manufacturing a docking traffic jam.
            for (let index = 0; index < configuration.players; index++) {
              console.error(
                `Equipping ${label}: client ${index + 1}/${configuration.players}`,
              );
              await workers
                .find((worker) => worker.indices.includes(index))
                .command('equip', { index, options });
            }

            console.error(`Equipment complete for ${label}`);
            const launches: Promise<unknown>[] = [];

            console.error(`Launching ${label}`);

            // Space real departures through a shared bay instead of putting
            // all player hulls at the same launch position simultaneously.
            for (let index = 0; index < configuration.players; index++) {
              const departure = workers
                .find((worker) => worker.indices.includes(index))
                .command('launch', { index });

              // Collect the failure after every departure has a cleanup path.
              void departure.catch(() => {});

              launches.push(departure);
              await pause(1000);
            }

            await Promise.all(launches);
            console.error(`All departures complete for ${label}`);
          }

          let readiness: unknown[];

          if (configuration.workload === 'spread') {
            const preparedAt = Date.now();
            const deadline = preparedAt + prepareTimeout * 1000;
            const discovery: Record<string, unknown>[] = [];

            spreadPreparation = {
              startedAt: preparedAt,
              deadline,
              speed: cruiseSpeed,
              speedMeasurement:
                'Binary-thrust threshold, not a hard speed cap. Eligibility reserves15 world units/s for the current engine tick impulse and100 units of distance; fresh checks also use any greater actual speed. Measured full-segment containment remains mandatory.',
              lateralAllowance: spreadLateralAllowance,
              discovery,
              measurement:
                'Straight corridors use current decoded real geometry and globally separated paths. Neutral warmup holds the chosen heading; ordinary binary keys cruise through the measurement without obstacle routing. New moving obstacles remain subject to intact-load and motion gates.',
            };

            await Promise.all(
              workers.map((worker) =>
                worker.command('fanout', { at: Date.now() + 100 }),
              ),
            );
            await pause(15000);
            await Promise.all(workers.map((worker) => worker.command('hold')));
            await pause(10000);
            let corridors: SpreadCorridor[];

            for (;;) {
              await Promise.all(
                workers.map((worker) => worker.command('checkReady')),
              );
              assert(
                Date.now() < deadline,
                'The shared spread preparation budget expired while reserving observed straight corridors',
              );
              const proposals = (
                await Promise.all(
                  workers.map((worker) =>
                    worker.command<SpreadCorridorProposal[]>(
                      'spreadCandidates',
                      { speed: cruiseSpeed },
                    ),
                  ),
                )
              ).flat();
              const largestShipRadius = Math.max(
                ...proposals.map((proposal) => proposal.radius),
              );
              const requiredObservedRadius =
                spreadCorridorLength +
                largestShipRadius +
                80 +
                spreadLateralAllowance +
                220;

              assert(
                requiredObservedRadius < replication.entityLoad,
                'The corridor plus ordinary asteroid and pilot clearance exceeds the observed entity-load range',
              );

              spreadPreparation.coverage = {
                entityLoadRange: replication.entityLoad,
                corridorLength: spreadCorridorLength,
                largestShipRadius,
                ordinaryAsteroidRadiusBound: 220,
                safetyMargin: 80,
                lateralAllowance: spreadLateralAllowance,
                requiredObservedRadius,
                unobservedBuffer:
                  replication.entityLoad - requiredObservedRadius,
                measurement:
                  'Current replication specifications load asteroid centers within2500. Ordinary generated asteroid radius is at most220 and procedural polygon wander is inward. Station/portal markers have longer ranges. This covers current static geometry; future moving arrivals are judged by measured integrity and activity.',
              };

              corridors = reserveSpreadCorridors({ proposals });

              discovery.push({
                at: Date.now(),
                clients: proposals.map((proposal) => ({
                  index: proposal.index,
                  position: proposal.position,
                  radius: proposal.radius,
                  candidates: proposal.candidates.length,
                  nearest: proposal.candidates.slice(0, 4),
                })),
                reserved: corridors,
              });

              const unassigned = proposals
                .filter(
                  (proposal) =>
                    !corridors.some(
                      (corridor) => corridor.index === proposal.index,
                    ),
                )
                .map((proposal) => proposal.index);

              console.error(
                `Reserving observed cruise corridors for ${label}: ${corridors.length}/${configuration.players}`,
              );

              if (!unassigned.length) break;

              await Promise.all(
                workers.map((worker) =>
                  worker.command('fanout', {
                    at: Date.now() + 100,
                    indices: unassigned,
                  }),
                ),
              );

              await pause(Math.max(1, Math.min(5000, deadline - Date.now())));
              await Promise.all(
                workers.map((worker) => worker.command('hold')),
              );
              await pause(Math.max(1, Math.min(10000, deadline - Date.now())));
            }

            await Promise.all(
              workers.map((worker) =>
                worker.command('spreadCorridors', { corridors }),
              ),
            );

            spreadPreparation.alignment = await Promise.all(
              workers.map((worker) =>
                worker.command('alignSpread', {
                  timeoutMs: Math.max(1, deadline - Date.now()),
                }),
              ),
            );

            spreadPreparation.corridors = corridors;
            spreadPreparation.reservedAt = Date.now();
            readiness = corridors;
          } else if (configuration.workload === 'module') {
            const approachStartedAt = Date.now();
            const deadline = approachStartedAt + prepareTimeout * 1000;
            const progress: Record<string, unknown>[] = [];
            const proposalsRetained: Record<string, unknown>[] = [];
            let targets: MiningTarget[] = [];
            let stage = 'departure';
            const indices = workers.flatMap((worker) => worker.indices);

            miningPreparation = {
              startedAt: approachStartedAt,
              deadline,
              totalBudgetSeconds: prepareTimeout,
              simultaneousClients: configuration.players,
              progress,
              proposals: proposalsRetained,
              targets,
              scheduling:
                "Discover real clear whole rocks from every client's own snapshots and reserve unique targets and noncrossing approaches globally. Confirmed clients wait with neutral thrust/turn and drills off through warmup and CPU observer setup, then resume ordinary controls and confirm powered mining immediately before measurement. Discovery, approach, and startup share one preparation budget; warmup and observer setup do not consume its remaining startup time.",
              contactReservation: `Unique decoded asteroid IDs and nonoverlapping ${miningWorkingRadius}-unit working disks. Anchor centers are separated by twice that radius plus both ship radii and120 units; initial contact poses and approaches retain their own hull clearance. Nominal contacts do not establish physical drill contact; strict readiness and measured causal work remain required.`,
              ownership: `After initial preparation, actual miner bodies must stay within their ${miningWorkingRadius}-unit disk. Whole target geometry and checked navigation endpoints reserve ${miningNavigationReserve} units inside that boundary; ordinary inward recovery retains safe powered drilling. This is a tested navigation reserve, not a formal bound on collision impulses.`,
              workingRadius: miningWorkingRadius,
              navigationReserve: miningNavigationReserve,
            };

            await Promise.all(workers.map((worker) => worker.command('hold')));
            preparationProgressOpen = true;

            preparationProgressTimer = setInterval(() => {
              void Promise.all(
                workers.map((worker) =>
                  worker.command<Record<string, unknown>[]>(
                    'preparationProgress',
                  ),
                ),
              )
                .then((parts) => {
                  if (!preparationProgressOpen) return;
                  const clients = parts.flat();

                  const observation = {
                    at: Date.now(),
                    stage,
                    elapsedSeconds: (Date.now() - approachStartedAt) / 1000,
                    confirmed: clients.filter((client) => client.confirmed)
                      .length,
                    clients,
                  };

                  progress.push(observation);

                  console.error(
                    JSON.stringify({
                      preparing: label,
                      stage,
                      elapsedSeconds: observation.elapsedSeconds,
                      confirmed: observation.confirmed,
                      players: configuration.players,
                    }),
                  );
                })
                .catch((error: Error) => {
                  if (preparationProgressOpen) {
                    console.error(
                      `Preparation progress unavailable: ${error.message}`,
                    );
                  }
                });
            }, 10000);

            const departedAt = Date.now();

            await Promise.all(
              workers.map((worker) =>
                worker.command('fanout', { at: departedAt + 100 }),
              ),
            );
            await pause(15000);
            await Promise.all(workers.map((worker) => worker.command('hold')));
            await pause(10000);

            miningPreparation.departure = {
              startedAt: departedAt,
              outwardSeconds: 15,
              maxSpeed: 100,
              neutralSettleSeconds: 10,
              endedAt: Date.now(),
            };

            stage = 'discovery';
            console.error(`Discovering clear real rocks for all ${label}`);

            for (;;) {
              await Promise.all(
                workers.map((worker) => worker.command('checkReady')),
              );
              assert(
                Date.now() < deadline,
                'The shared mining preparation budget expired while finding clear real rocks',
              );
              const proposals = (
                await Promise.all(
                  workers.map((worker) =>
                    worker.command<MiningProposal[]>('miningCandidates'),
                  ),
                )
              ).flat();

              // Rebuild all provisional routes from current positions after
              // any unassigned client moves; no stale route is reserved.
              targets = reserveMiningTargets({ proposals });
              miningPreparation.targets = targets;

              proposalsRetained.push({
                at: Date.now(),
                clients: proposals.map(
                  ({ index, position, radius, wholeRocks, candidates }) => ({
                    index,
                    position,
                    radius,
                    wholeRocks,
                    clearApproaches: candidates.length,
                    nearest: candidates
                      .toSorted((a, b) => a.distance - b.distance)
                      .slice(0, 4),
                  }),
                ),
                reserved: targets,
              });

              const unassigned = indices.filter(
                (index) => !targets.some((target) => target.index === index),
              );

              if (!unassigned.length) break;
              console.error(
                `Finding clear rocks for ${label}: ${indices.length - unassigned.length}/${indices.length} reserved`,
              );

              const phaseAt = Date.now() + 100;

              await Promise.all(
                workers.map((worker) =>
                  worker.command('fanout', {
                    at: phaseAt,
                    indices: unassigned,
                  }),
                ),
              );

              await pause(Math.max(1, Math.min(5000, deadline - Date.now())));
              await Promise.all(
                workers.map((worker) => worker.command('hold')),
              );
            }

            await Promise.all(
              workers.map((worker) =>
                worker.command('miningTargets', { targets }),
              ),
            );
            stage = 'approach';
            console.error(`Approaching real rocks together for ${label}`);
            const startedAt = Date.now();
            const phaseAt = startedAt + 100;

            await Promise.all(
              workers.map((worker) =>
                worker.command('workload', { at: phaseAt }),
              ),
            );

            const reached = await Promise.all(
              workers.map((worker) =>
                worker.command<{
                  clients: { index: number; position: Vec.Value }[];
                }>('readyWorkload', {
                  timeoutMs: Math.max(1, deadline - Date.now()),
                }),
              ),
            );

            readiness = reached;
            const confirmed = reached.flatMap((group) => group.clients);

            miningPreparation.approach = {
              startedAt,
              confirmedAt: Date.now(),
              clients: confirmed,
            };

            await Promise.all(
              workers.map((worker) => worker.command('checkReady')),
            );
          } else {
            const phaseAt = Date.now() + 100;

            console.error(`Checking physical readiness for ${label}`);
            await Promise.all(
              workers.map((worker) =>
                worker.command('workload', { at: phaseAt }),
              ),
            );

            readiness = await Promise.all(
              workers.map((worker) =>
                worker.command('readyWorkload', {
                  timeoutMs: prepareTimeout * 1000,
                }),
              ),
            );
          }

          const physicalReadyAt = Date.now();

          preparationProgressOpen = false;
          clearInterval(preparationProgressTimer);

          await pause(warmup * 1000);
          console.error(`Checking current readiness after warmup for ${label}`);
          await Promise.all(
            workers.map((worker) => worker.command('checkReady')),
          );

          const observe = () =>
            observeServerCpu({
              url,
              pid: coreLimit?.metadata.pid,
              cpuIds: coreLimit?.metadata.logicalCpuIds,
              steadySince: physicalReadyAt,
            });

          let observer = local ? undefined : await observe();
          let firingEnabledAt: number;
          let firingReadyAt: number;

          if (configuration.workload === 'spread') {
            spreadPreparation.neutralConfirmation = await Promise.all(
              workers.map((worker) =>
                worker.command('alignSpread', {
                  timeoutMs: Math.max(
                    1,
                    Number(spreadPreparation.deadline) - Date.now(),
                  ),
                }),
              ),
            );

            spreadPreparation.cruiseEnabledAt = Date.now();
            const cruiseAt = Date.now() + 100;

            spreadPreparation.cruiseConfirmation = await Promise.all(
              workers.map((worker) =>
                worker.command('enableCruise', {
                  at: cruiseAt,
                  seconds,
                }),
              ),
            );
          }

          if (configuration.workload === 'module') {
            const resumeAt = Date.now() + 100;

            await Promise.all(
              workers.map((worker) =>
                worker.command('workload', { at: resumeAt }),
              ),
            );

            miningPreparation.activation = await Promise.all(
              workers.map((worker) =>
                worker.command('enableMining', {
                  timeoutMs: Math.max(
                    1,
                    Number(miningPreparation.deadline) - physicalReadyAt,
                  ),
                }),
              ),
            );
          }

          if (configuration.workload === 'weapon') {
            firingEnabledAt = Date.now();
            await Promise.all(
              workers.map((worker) => worker.command('enableFiring')),
            );
            firingReadyAt = Date.now();
          }

          observer ??= await observe();

          if (configuration.workload === 'spread') {
            spreadPreparation.finalClearance = await Promise.all(
              workers.map((worker) =>
                worker.command('checkSpreadCorridor', {
                  seconds,
                }),
              ),
            );
          }

          const hostBefore = await hostCpu();
          const startedAt = new Date().toISOString();
          const activeWindow = { start: Date.now(), end: 0 };
          const coordinatorAt = performance.now();
          const coordinatorBefore = process.cpuUsage();
          const coordinatorRssAtStart = process.memoryUsage().rss;

          await Promise.all(workers.map((worker) => worker.command('start')));
          console.error(`Measuring ${label} for ${seconds}s`);
          await pause(seconds * 1000);
          let serverCpu = local ? await observer.finish() : undefined;

          activeWindow.end = Date.now();
          const generators = await Promise.all(
            workers.map((worker) => worker.command<WorkerResult>('stop')),
          );
          const coordinatorElapsedMs = performance.now() - coordinatorAt;
          const coordinatorUsed = process.cpuUsage(coordinatorBefore);
          const coordinatorRssAtEnd = process.memoryUsage().rss;

          const coordinator = {
            pid: process.pid,
            elapsedMs: coordinatorElapsedMs,
            cpuUserMs: coordinatorUsed.user / 1000,
            cpuSystemMs: coordinatorUsed.system / 1000,
            cpuPercentOfOneCore:
              (coordinatorUsed.user + coordinatorUsed.system) /
              10 /
              coordinatorElapsedMs,
            rssBytes: Math.max(coordinatorRssAtStart, coordinatorRssAtEnd),
            rssAtStart: coordinatorRssAtStart,
            rssAtEnd: coordinatorRssAtEnd,
            memoryMeasurement:
              'RSS sampled at measurement boundaries; no claim of an interior peak.',
          };

          const hostAfter = await hostCpu();
          const historicalCpu = local
            ? undefined
            : observer.finish(activeWindow);

          // Retain a receipt/ack tail, without crediting its snapshots as load.
          await pause(3000);
          const clients = (
            await Promise.all(
              workers.map((worker) => worker.command<ClientResult[]>('report')),
            )
          )
            .flat()
            .toSorted((a, b) => a.index - b.index);

          await Promise.all(workers.map((worker) => worker.close()));
          serverCpu ??= await historicalCpu;

          const clientValidation = validateProtocolCase({
            clients,
            seconds,
            workload: configuration.workload,
            players: configuration.players,
          });

          const generatorFailures = generators.flatMap((generator, index) => {
            const failures: string[] = [];

            if (generator.eventLoopDelayMs.p99 > 5) {
              failures.push(
                `worker ${index}: event loop delay p99 exceeds 5 ms`,
              );
            }

            if (generator.inputTimerGapMs.p99 > 1000 / 30 + 5) {
              failures.push(
                `worker ${index}: input timer gap p99 exceeds its 5 ms allowance`,
              );
            }

            if (generator.cpuPercentOfOneCore >= 90) {
              failures.push(
                `worker ${index}: generator CPU reaches 90% of one core`,
              );
            }

            return failures;
          });

          for (const client of clients) {
            if (client.decodeMs.p99 > 1000 / 30) {
              generatorFailures.push(
                `client ${client.index}: incoming callback p99 exceeds the 33.33 ms publication budget`,
              );
            }
          }

          const hostCpuPercent = hostUtilization(hostBefore, hostAfter);

          if (hostCpuPercent >= 90) {
            generatorFailures.push(
              'The generator host used at least 90% of all logical CPUs',
            );
          }

          const valid =
            clientValidation.valid &&
            !generatorFailures.length &&
            serverCpu.available;

          const result = {
            ...configuration,
            repetition,
            startedAt,
            readiness,
            miningPreparation,
            spreadPreparation,
            physicalReadyAt,
            activeWindow,
            firingWindow:
              configuration.workload === 'weapon'
                ? {
                    enabledAt: firingEnabledAt,
                    confirmedAt: firingReadyAt,
                    stoppedAt: activeWindow.end,
                    measurement:
                      'Application fire request, decoded authoritative confirmation, and neutralization request; not exact server-apply timestamps.',
                  }
                : null,
            valid,
            clientValidation,
            serverCadence: {
              ...clientValidation.serverCadence,
              tickSkips: summarizeTickSkips(clients),
              measurement:
                'Shared prior/current tick IDs establish that multiple clients observe the same missing intermediate world state. The server publishes once after a catch-up batch; this can explain shared skips but is not isolated proof of their cause. Cadence concerns remain separate from consumption/headroom qualification.',
            },
            generatorHeadroom: {
              valid: !generatorFailures.length,
              failures: generatorFailures,
            },
            serverCpu,
            serverAllocations: {
              available: false,
              reason:
                'Public gameplay protocol and OS CPU counters expose no Go allocation counters.',
            },
            generators,
            coordinator,
            generatorTotalCpuPercentOfOneCore: generators.reduce(
              (sum, worker) => sum + worker.cpuPercentOfOneCore,
              coordinator.cpuPercentOfOneCore,
            ),
            generatorTotalRssBytes: generators.reduce(
              (sum, worker) => sum + worker.rssBytes,
              coordinator.rssBytes,
            ),
            generatorMemoryMeasurement:
              'Sum of worker maximum RSS sampled by each 30Hz control timer and coordinator maximum boundary-sampled RSS; not a simultaneous or continuously sampled whole-generator peak.',
            hostCpuPercent,
            freeMemoryBytes: freemem(),
            clients,
          };

          report.results.push(result);
          await save();

          console.error(
            JSON.stringify({
              case: label,
              valid,
              clientValidation: clientValidation.valid,
              serverCadence: clientValidation.serverCadence.valid,
              headroom: !generatorFailures.length,
              serverCpu: {
                available: serverCpu.available,
                source: serverCpu.source,
                cpuPercentOfOneCore:
                  'cpuPercentOfOneCore' in serverCpu
                    ? serverCpu.cpuPercentOfOneCore
                    : null,
                cpuPercentOfMachine:
                  'cpuPercentOfMachine' in serverCpu
                    ? serverCpu.cpuPercentOfMachine
                    : null,
                processCpuPercentOfOneCore:
                  'process' in serverCpu
                    ? serverCpu.process?.cpuPercentOfOneCore
                    : undefined,
              },
            }),
          );
        } catch (error) {
          const preparationDiagnostics = await Promise.allSettled(
            workers.map(async (worker) =>
              Promise.race([
                worker.command('diagnostics'),
                pause(2000).then(() => {
                  throw new Error('Timed out retaining worker diagnostics');
                }),
              ]),
            ),
          );

          report.results.push({
            ...configuration,
            repetition,
            miningPreparation,
            spreadPreparation,
            preparationDiagnostics: preparationDiagnostics.map((result) =>
              result.status === 'fulfilled'
                ? result.value
                : {
                    error:
                      result.reason instanceof Error
                        ? result.reason.message
                        : String(result.reason),
                  },
            ),
            valid: false,
            error:
              error instanceof Error ? error.message : JSON.stringify(error),
          });

          await save();
          console.error(
            `${label}: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
          );
        } finally {
          preparationProgressOpen = false;
          clearInterval(preparationProgressTimer);
          await Promise.all(workers.map((worker) => worker.close()));
          activeWorkers = [];
        }

        await pause(1000);
      }
    }

    report.complete = report.results.length === cases.length * repetitions;
  } catch (error) {
    report.error =
      error instanceof Error
        ? error.message
        : (JSON.stringify(error) ?? 'Unknown benchmark failure');
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);

    try {
      await coreLimit?.restore();
    } finally {
      await save();
      await rm(directory, { recursive: true, force: true });
    }
  }

  console.log(output);

  if (report.results.some((result) => !result.valid)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
