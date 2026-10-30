import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { localServerPid, parseProcessStat } from '../server/observer.ts';

const { values } = parseArgs({
  options: {
    directory: {
      type: 'string',
      default: 'benchmarking/_local/collector-cleanup',
    },
    'mining-seconds': { type: 'string', default: '60' },
    'prepare-timeout': { type: 'string', default: '600' },
  },
});

const directory = resolve(values.directory);
const seconds = Number(values['mining-seconds']);

assert(
  Number.isFinite(seconds) && seconds > 0 && seconds < 180,
  'Interrupt within the unchanged 180 s workload',
);
await mkdir(directory, { recursive: true });
const pid = await localServerPid();
const arguments_ = [
  'benchmarking/server/run.ts',
  '--target',
  'local',
  '--cores',
  '2',
  '--players',
  '32',
  '--workload',
  'module',
  '--seconds',
  '180',
  '--warmup',
  '15',
  '--prepare-timeout',
  values['prepare-timeout'],
  '--output',
  resolve(directory, 'mining-interrupted.json'),
];
const environment = (await readFile(`/proc/${pid}/environ`, 'utf8')).split(
  '\0',
);

const runtime = Object.fromEntries(
  environment
    .filter((entry) =>
      /^(GOMEMLIMIT|GOGC|GOMAXPROCS|GOEXPERIMENT|GOFLAGS)=/.test(entry),
    )
    .map((entry) => {
      const index = entry.indexOf('=');

      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
);

assert.equal(runtime.GOMEMLIMIT, '300MiB', 'Match the live Go memory budget');
const startedAt = Date.now();

const manifest = {
  command: [process.execPath, ...arguments_],
  startedAt,
  pid,
  runtime,
  miningSeconds: seconds,
  measurementAt: 0,
  interruptAt: 0,
  exitAt: 0,
  code: null as number | null,
  signal: null as string | null,
};

const logPath = resolve(directory, 'mining.log');
const cpuPath = resolve(directory, 'mining-cpu.jsonl');
const output = resolve(directory, 'mining-run.json');

const child = spawn(process.execPath, arguments_, {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const completion = new Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}>((resolve) => {
  child.once('error', (error) => resolve({ code: null, signal: null, error }));
  child.once('exit', (code, signal) => resolve({ code, signal }));
});

let interruptTimer: NodeJS.Timeout;
let cpuTimer: NodeJS.Timeout;
let logTail = '';
let writes = Promise.resolve();
let cpuWrites = Promise.resolve();
let failed: unknown;

const save = () => writeFile(output, JSON.stringify(manifest, null, 2) + '\n');

const stopOnError = (error: unknown) => {
  failed ||= error;
  child.kill('SIGINT');
};

const recordCpu = async () => {
  const stat = parseProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
  const status = await readFile(`/proc/${pid}/status`, 'utf8');

  await appendFile(
    cpuPath,
    JSON.stringify({
      at: Date.now(),
      ...stat,
      affinity: status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1],
      rssKiB: Number(status.match(/^VmRSS:\s*(\d+)/m)?.[1]),
    }) + '\n',
  );
};

const capture = (data: Buffer) => {
  const text = data.toString();

  process.stderr.write(text);
  writes = writes.then(() => appendFile(logPath, text)).catch(stopOnError);
  logTail = (logTail + text).slice(-2048);

  if (
    !manifest.measurementAt &&
    logTail.includes('Measuring 32 players / module / 1 for 180s')
  ) {
    manifest.measurementAt = Date.now();
    writes = writes.then(save).catch(stopOnError);

    interruptTimer = setTimeout(() => {
      manifest.interruptAt = Date.now();
      process.stderr.write(
        `Interrupting standard module workload after ${seconds} s of its active measurement\n`,
      );
      writes = writes.then(save).catch(stopOnError);
      child.kill('SIGINT');
    }, seconds * 1000);
  }
};

child.stdout.on('data', capture);
child.stderr.on('data', capture);
const forwardInterrupt = () => child.kill('SIGINT');

process.once('SIGINT', forwardInterrupt);
process.once('SIGTERM', forwardInterrupt);

try {
  await save();
  await recordCpu();

  cpuTimer = setInterval(() => {
    cpuWrites = cpuWrites.then(recordCpu).catch(stopOnError);
  }, 1000);

  const { code, signal, error } = await completion;

  if (error) throw error;

  manifest.exitAt = Date.now();
  manifest.code = code;
  manifest.signal = signal;
  await pause(5000);
  await cpuWrites;
  await recordCpu();
  await writes;
  await save();

  if (failed) throw failed;
  assert(
    manifest.measurementAt && manifest.interruptAt,
    'Workload failed before its planned interruption',
  );
  assert.equal(
    code,
    130,
    'Expected orderly SIGINT capture with socket disconnects',
  );
  console.log(
    `Miners disconnected; preserved real debris. Manifest: ${output}`,
  );
} finally {
  clearInterval(cpuTimer);
  clearTimeout(interruptTimer);

  if (child.pid && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGINT');
    const force = setTimeout(() => child.kill('SIGKILL'), 15000);

    try {
      await completion;
    } finally {
      clearTimeout(force);
    }
  }

  process.off('SIGINT', forwardInterrupt);
  process.off('SIGTERM', forwardInterrupt);
}
