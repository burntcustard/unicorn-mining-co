import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';

const { values } = parseArgs({
  options: {
    seconds: { type: 'string', default: '15' },
    output: {
      type: 'string',
      default: 'benchmarking/_local/server.cpu.pprof.gz',
    },
  },
});

const seconds = Number(values.seconds);

assert(
  Number.isInteger(seconds) && seconds >= 1 && seconds <= 60,
  'Use 1–60 seconds',
);

const { stdout } = await promisify(execFile)(
  './bin/server',
  ['--cpu-profile-live', String(seconds)],
  {
    encoding: 'utf8',
    timeout: (seconds + 10) * 1000,
    maxBuffer: 16 * 1024 * 1024,
  },
);

const profile = Buffer.from(stdout.trim(), 'base64');

assert(
  profile[0] === 0x1f && profile[1] === 0x8b,
  'Expected a compressed CPU profile',
);

const output = resolve(values.output);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, profile);
console.log(output);
