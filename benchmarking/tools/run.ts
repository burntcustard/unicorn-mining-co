// CDP method replies and evaluated page values are heterogeneous JSON.
type CdpReply = Record<string, any>;
type Send = (method: string, params?: object) => Promise<CdpReply>;

/* global process */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { startBrowserGameplay } from './browser-gameplay.ts';
import { createGameplayWorkload } from './gameplay-workload.ts';

const host = '127.0.0.1';
const gamePort = 3000;
const debugPort = Number(process.env.BENCH_DEBUG_PORT || 9333);
const seconds = Number(process.env.BENCH_SECONDS || 5);
const warmup = Number(process.env.BENCH_WARMUP || 2);
const filter = process.env.BENCH_FILTER;
const headless = process.env.BENCH_HEADLESS === '1';
const chrome = process.env.CHROME_BIN || 'google-chrome';
const profile = await mkdtemp(join(tmpdir(), 'unicorn-benchmark-'));
const children: ReturnType<typeof spawn>[] = [];

const launch = (command: string, args: string[]) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  children.push(child);

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString();

    if (/error|failed/i.test(message) && !/registration/i.test(message)) {
      process.stderr.write(message);
    }
  });

  return child;
};

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const stop = (child: ReturnType<typeof spawn>) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();

    child.once('exit', resolve);
    child.kill('SIGTERM');
  });

const waitFor = async (url: string, attempts = 50) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) return response;
    } catch {
      // The server or debugging endpoint is still starting.
    }

    await pause(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

let socket: WebSocket;
let messageId = 0;

const pending = new Map<
  number,
  {
    resolve: (reply: CdpReply) => void;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }
>();

const send: Send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;

    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });

const press = async (key: string, code: string) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
};

const tests = [
  { name: 'baseline' },
  { name: 'sky fog', sky: 1 },
  { name: 'sky dots', sky: 2 },
  { name: 'sky sparkles', sky: 3 },
  { name: 'sky off', sky: 4 },
  { name: 'no background', query: 'noBackground' },
  { name: 'no gradients', query: 'noGradients' },
  { name: 'no blur', query: 'noBlur' },
  { name: 'lamp on', lamp: true },
  { name: 'no beam', query: 'noBeam', lamp: true },
  { name: 'lighting off', query: 'noLighting' },
  { name: 'asteroid field', query: 'field' },
  { name: 'asteroid field no beam', query: 'field&noBeam' },
  { hold: 'ArrowRight', name: 'asteroid field spinning', query: 'field' },
  { name: 'asteroid segments', query: 'field', asteroidSegments: true },
  { name: 'physics off', physicsOff: true },
];

try {
  await waitFor(`http://${host}:${gamePort}`);
  const benchmarkSource = await (
    await fetch(`http://${host}:${gamePort}/src/client/debug/benchmark.ts`)
  ).text();

  if (!benchmarkSource.includes('new URLSearchParams')) {
    throw new Error(
      'Start Vite with npm run dev -- --strictPort --mode benchmark',
    );
  }

  launch(chrome, [
    ...(headless ? ['--headless=new'] : ['--new-window']),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=2880,1800',
    'about:blank',
  ]);
  const pages = await (
    await waitFor(`http://${host}:${debugPort}/json`)
  ).json();

  const page = pages.find(({ type }: { type: string }) => type === 'page');

  if (!page) throw new Error('Chrome did not expose a page target');
  socket = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse((data as Buffer).toString());
    const request = pending.get(message.id);

    if (!request) return;
    pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(JSON.stringify(message.error)));
    } else {
      request.resolve(message.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  await send('Emulation.setDeviceMetricsOverride', {
    width: 2880,
    height: 1800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const results = [];

  const selectedTests = filter
    ? tests.filter(({ name }) => name.includes(filter))
    : tests;

  for (const test of selectedTests) {
    await send('Page.navigate', {
      url: `http://${host}:${gamePort}/?${test.query || ''}`,
    });

    await pause(warmup * 1000);

    const evaluate = async (expression: string) => {
      const reply = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });

      if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception.description);
      }

      return reply.result.value;
    };

    await evaluate(startBrowserGameplay);

    if (test.query?.includes('field')) {
      await evaluate(createGameplayWorkload());
      await pause(warmup * 1000);
    }

    for (let cycle = 0; cycle < (test.sky || 0); cycle++) {
      await evaluate(
        "import('/src/client/background/background.ts').then(({sky}) => sky.cycle())",
      );
    }

    if (test.lamp) await press('l', 'KeyL');

    if (test.physicsOff) {
      await evaluate(
        'network.updateFrame = () => false; network.predictFrame = () => network.world',
      );
    }

    if (test.hold) {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: test.hold,
        code: test.hold,
      });
    }

    if (test.asteroidSegments) {
      console.table([
        await evaluate(`(() => {
        const rocks = game.sprites.filter(object => object.kind === 'asteroid');
        if (!rocks.length) throw Error('The asteroid field must be populated');
        return {asteroids: rocks.length, segments: rocks.reduce((sum, rock) => sum + (rock.segments?.length || 1), 0)};
      })()`),
      ]);
    }

    if (test.sky || test.lamp || test.physicsOff) await pause(1000);

    const evaluated = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise(resolve => {
        const gaps = [];
        let before = performance.now();
        const start = before;
        const frame = now => {
          gaps.push(now - before);
          before = now;
          if (now - start < ${seconds * 1000}) requestAnimationFrame(frame);
          else {
            gaps.shift();
            gaps.sort((a, b) => a - b);
            const total = gaps.reduce((sum, gap) => sum + gap, 0);
            resolve({
              fps: gaps.length * 1000 / total,
              p95: gaps[Math.floor(gaps.length * 0.95)],
              slow: gaps.filter(gap => gap > 20).length,
            });
          }
        };
        requestAnimationFrame(frame);
      })`,
    });

    if (test.hold) {
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: test.hold,
        code: test.hold,
      });
    }

    const measured = evaluated.result.value;

    results.push({
      test: test.name,
      fps: measured.fps.toFixed(1),
      p95: measured.p95.toFixed(1),
      framesOver20ms: measured.slow,
    });

    console.table([results.at(-1)]);
  }

  console.log('\nJSON results:');
  console.log(JSON.stringify(results, null, 2));
} finally {
  socket?.close();
  await Promise.all(children.reverse().map(stop));

  await rm(profile, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 200,
  });
}
