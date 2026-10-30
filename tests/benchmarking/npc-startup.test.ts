import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = resolve('benchmarking/npc/run.ts');
const directory = mkdtempSync(join(tmpdir(), 'unicorn-npc-startup-'));

/*
 * Run the real CLI and its validation. Replace only process inspection and
 * external side effects; each case owns its manifest, overlay, and report.
 */
const stubs = {
  'benchmarking/server/observer.ts': String.raw`
    export async function localServerPid() {
      if (globalThis.npcStartupTest.scenario.kind === 'no-server') {
        throw new Error('Cannot identify exactly one local server on port3001');
      }
      return 424242;
    }
    export async function observeServerCpu() { throw new Error('Unexpected CPU observation'); }
  `,
  'benchmarking/server/cores.ts': String.raw`
    export async function limitServerCores() {
      globalThis.npcStartupTest.record('affinity');
      throw new Error('Unexpected CPU affinity mutation before valid startup');
    }
  `,
  'benchmarking/npc/browser.ts': String.raw`
    export async function openNPCBrowser() {
      globalThis.npcStartupTest.record('browser');
      throw new Error('Unexpected browser launch before valid startup');
    }
  `,
  'benchmarking/server/client.ts': String.raw`
    export class ProtocolClient {
      constructor() {
        globalThis.npcStartupTest.record('client');
        throw new Error('Unexpected game connection before valid startup');
      }
    }
  `,
  'benchmarking/utilities/protocol-runtime.ts': String.raw`
    export async function loadProtocolRuntime() {
      globalThis.npcStartupTest.record('runtime');
      throw new Error('Unexpected protocol build before valid startup');
    }
  `,
};

const loader = String.raw`
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
import * as filesystem from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const scenario = JSON.parse(process.env.NPC_STARTUP_CASE);
const real = filesystem.promises;
const record = (action) => appendFileSync(scenario.actions, action + '\n');
const environment = [
  ...(scenario.kind === 'missing-budget' ? [] : ['GOMEMLIMIT=300MiB']),
  'GOGC=100',
  'GOFLAGS=-overlay=' + (scenario.kind === 'wrong-overlay' ? scenario.otherOverlay : scenario.overlay),
].join('\0') + '\0';

const files = {
  ...real,
  async readFile(path, ...args) {
    if (String(path) === '/proc/424242/environ') return environment;
    return real.readFile(path, ...args);
  },
  async readlink(path, ...args) {
    if (String(path) === '/proc/424242/cwd') return process.cwd();
    return real.readlink(path, ...args);
  },
};

globalThis.npcStartupTest = { files, record, scenario };
globalThis.fetch = async () => {
  if (scenario.kind === 'no-frontend') throw new Error('Connection refused');
  return new Response('local frontend fixture', { status: 200 });
};



const replacements = new Map(Object.entries(scenario.stubs).map(([path, source]) => [
  pathToFileURL(resolve(scenario.root, path)).href,
  source,
]));

registerHooks({
  load(url, context, nextLoad) {
    let source = replacements.get(url);
    if (url === 'node:fs/promises') {
      source = Object.keys(files).filter((name) => /^[a-zA-Z_$][\w$]*$/.test(name))
        .map((name) => 'export const ' + name + ' = globalThis.npcStartupTest.files.' + name + ';').join('\n');
    }
    return source === undefined ? nextLoad(url, context) : { format: 'module', source, shortCircuit: true };
  },
});
`;

try {
  const preload = join(directory, 'loader.ts');

  writeFileSync(preload, loader);

  for (const scenario of [
    { kind: 'missing-fixture', message: /benchmark:npc:prepare/ },
    { kind: 'no-server', message: /3001/, command: /dev:server/ },
    { kind: 'missing-budget', message: /300MiB/, command: /dev:server/ },
    { kind: 'wrong-overlay', message: /overlay/i, command: /dev:server/ },
    {
      kind: 'no-frontend',
      message: /3000/,
      command: /npm run dev -- --strictPort/,
    },
  ]) {
    const cwd = join(directory, scenario.kind);
    const fixture = join(cwd, 'fixture');
    const overlay = join(fixture, 'overlay.json');
    const otherOverlay = join(fixture, 'other-overlay.json');
    const manifest = join(cwd, 'benchmarking/_local/npc-fixture.json');
    const output = join(cwd, 'report.json');
    const actions = join(cwd, 'actions.log');

    mkdirSync(fixture, { recursive: true });
    writeFileSync(overlay, JSON.stringify({ Replace: {} }));
    writeFileSync(otherOverlay, JSON.stringify({ Replace: {} }));
    writeFileSync(actions, '');

    if (scenario.kind !== 'missing-fixture') {
      mkdirSync(dirname(manifest), { recursive: true });
      writeFileSync(manifest, JSON.stringify({ directory: fixture, items: 6 }));
    }

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        entry,
        '--watch',
        '--scenario',
        'collector-empty',
        '--seconds',
        '5',
        '--warmup',
        '0',
        '--repetitions',
        '1',
        '--output',
        output,
      ],
      {
        cwd,
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          NPC_STARTUP_CASE: JSON.stringify({
            ...scenario,
            root: process.cwd(),
            stubs,
            actions,
            overlay,
            otherOverlay,
          }),
        },
      },
    );

    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /NPC benchmark failed:/);
    assert.match(result.stderr, scenario.message);

    if (scenario.command) assert.match(result.stderr, scenario.command);

    assert(result.stderr.includes(`Report: ${output}`), result.stderr);
    assert.equal(
      readFileSync(actions, 'utf8'),
      '',
      'Invalid startup must not launch a browser, connect a client, change affinity, or build the protocol runtime',
    );

    const report = JSON.parse(readFileSync(output, 'utf8')) as {
      complete: boolean;
      results: unknown[];
      error: string;
    };

    assert.equal(report.complete, false);
    assert.deepEqual(report.results, []);
    assert.match(report.error, scenario.message);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
