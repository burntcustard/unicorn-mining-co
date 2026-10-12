import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { backupsLive, parseBackupArgs } from '../../scripts/backups-live.ts';

for (const [options, command] of [
  [{}, "'/app/server' '--backups'"],
  [
    { deletePath: '/data/backups/world-20261012T120000.000000000.sqlite' },
    "'/app/server' '--delete-backup' '/data/backups/world-20261012T120000.000000000.sqlite'",
  ],
  [{ deleteAll: true }, "'/app/server' '--delete-all-backups'"],
  [
    { deletePath: "/data/backup with 'quotes'" },
    "'/app/server' '--delete-backup' '/data/backup with '\\''quotes'\\'''",
  ],
] as const) {
  const calls: string[][] = [];
  let output = '';

  await backupsLive({
    app: 'test-app',
    ...options,
    output: (text) => {
      output += text;
    },
    run: async (args) => {
      calls.push(args);

      if (args[1] === 'list') {
        assert.deepEqual(args, [
          'machine',
          'list',
          '--app',
          'test-app',
          '--json',
        ]);

        return [
          {
            id: 'game',
            state: 'started',
            config: { mounts: [{ path: '/data' }] },
          },
        ];
      }

      assert.deepEqual(args, [
        'machine',
        'exec',
        'game',
        command,
        '--app',
        'test-app',
        '--json',
        '--timeout',
        '25',
      ]);

      // Successful Fly exec responses can omit their zero exit code.
      return { stdout: 'Backups: 2; volume available\n' };
    },
  });

  assert.deepEqual(
    calls.map((args) => args[1]),
    ['list', 'exec'],
    'maintenance does not stop or reconfigure the Machine',
  );
  assert.match(output, /test-app\/game.*Backups: 2/s);
}

for (const [state, count, expected] of [
  ['stopped', 1, /requires a running Machine/],
  ['started', 0, /found 0/],
  ['started', 2, /found 2/],
] as const) {
  await assert.rejects(
    backupsLive({
      app: 'test-app',
      run: async (args) => {
        assert.equal(
          args[1],
          'list',
          'invalid Machine selection cannot execute a command',
        );

        return Array.from({ length: count }, () => ({
          id: 'game',
          state,
          config: { mounts: [{ path: '/data' }] },
        }));
      },
    }),
    expected,
  );
}

for (const [result, expected] of [
  [{ exit_code: 1, stderr: 'not a listed backup' }, /not a listed backup/],
  [
    { exit_code: 2, stderr: 'flag provided but not defined: -backups' },
    /flag provided but not defined/,
  ],
  [{ exit_code: 0, exit_signal: 9 }, /signal 9/],
  [{ stdout: '' }, /exit unknown/],
] as const) {
  await assert.rejects(
    backupsLive({
      app: 'test-app',
      output: () => {},
      run: async (args) =>
        args[1] === 'list'
          ? [
              {
                id: 'game',
                state: 'started',
                config: { mounts: [{ path: '/data' }] },
              },
            ]
          : result,
    }),
    expected,
  );
}

assert.deepEqual(parseBackupArgs([]), {
  app: undefined,
  deletePath: undefined,
  deleteAll: false,
  help: false,
});

assert.equal(
  parseBackupArgs([
    '--delete',
    '/data/world.sqlite.reset-123',
    '--app',
    'other-app',
  ]).deletePath,
  '/data/world.sqlite.reset-123',
);
assert.equal(parseBackupArgs(['--delete', '--all']).deleteAll, true);

for (const args of [
  ['--delete'],
  ['--delete', ''],
  ['--all'],
  ['--delete', '--all', '/data/backup'],
  ['/data/backup'],
  ['--delete', '/data/a', '/data/b'],
  ['--typo'],
]) {
  assert.throws(() => parseBackupArgs(args));
}

const directory = await mkdtemp(join(tmpdir(), 'unicorn-backups-test-'));

try {
  const database = join(directory, 'world.sqlite');
  const backups = join(directory, 'backups');
  const archive = `${database}.reset-123`;
  const periodic = join(backups, 'world-20261012T120000.000000000.sqlite');
  const temporary = `${periodic}.tmp`;

  await mkdir(backups);
  await mkdir(archive);

  for (const path of [
    database,
    `${database}-wal`,
    periodic,
    temporary,
    join(archive, 'world.sqlite'),
  ]) {
    await writeFile(path, 'keep');
  }

  const run = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(resolve('bin/server'), args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'development',
        NODE_ENV: 'development',
        DATABASE_PATH: database,
        BACKUP_DIRECTORY: backups,
      },
    });

    return stdout;
  };

  const listed = await run('--backups');

  assert.match(listed, /Backups: 2 \(1 periodic, 1 reset archives\)/);
  assert.match(listed, /available,.*used,.*total/);
  assert(listed.includes(periodic));
  assert(listed.includes(archive));

  const deletedOne = await run('--delete-backup', archive);

  assert.match(deletedOne, /After deleting 1 backup\(s\):\n.*Backups: 1/s);
  const deletedAll = await run('--delete-all-backups');

  assert.match(deletedAll, /After deleting 1 backup\(s\):\nBackups: 0/s);

  for (const path of [database, `${database}-wal`, temporary]) {
    assert.equal(await readFile(path, 'utf8'), 'keep');
  }

  await assert.rejects(run('--delete-backup', ''), /requires a nonempty path/);
  await assert.rejects(
    run('--backups', '--delete-all-backups'),
    /choose one maintenance command/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(
  'Live backup commands list storage and safely delete one or all backups',
);
