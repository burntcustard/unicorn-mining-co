import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));

const build = spawn(process.execPath, ['scripts/build-server.ts'], {
  cwd,
  stdio: 'inherit',
});

const [buildCode] = await once(build, 'exit');

if (buildCode !== 0) process.exit(buildCode ?? 1);

const child = spawn('./bin/server', ['--reset-world'], {
  cwd,
  env: {
    ...process.env,
    APP_ENV: 'development',
    NODE_ENV: 'development',
  },
  stdio: 'inherit',
});

const [code] = await once(child, 'exit');

process.exitCode = code ?? 1;
