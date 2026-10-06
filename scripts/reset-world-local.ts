import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const child = spawn('go', ['run', './src/server', '--reset-world'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    GOEXPERIMENT: 'simd',
    APP_ENV: 'development',
    NODE_ENV: 'development',
    DATABASE_PATH: fileURLToPath(
      new URL('../.data/world.sqlite', import.meta.url),
    ),
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

const [code] = await once(child, 'exit');

process.exitCode = code ?? 1;
