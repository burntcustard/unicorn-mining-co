/* global process */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const host = '127.0.0.1';
const gamePort = Number(process.env.BENCH_GAME_PORT || 4273);
const debugPort = Number(process.env.BENCH_DEBUG_PORT || 9333);
const seconds = Number(process.env.BENCH_SECONDS || 5);
const warmup = Number(process.env.BENCH_WARMUP || 2);
const filter = process.env.BENCH_FILTER;
const chrome = process.env.CHROME_BIN || 'google-chrome';
const profile = await mkdtemp(join(tmpdir(), 'unicorn-benchmark-'));
const children = [];

const launch = (command, args) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  children.push(child);
  child.stderr.on('data', (chunk) => {
    const message = chunk.toString();

    if (/error|failed/i.test(message) && !/registration/i.test(message)) process.stderr.write(message);
  });
  return child;
};

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stop = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode) return resolve();

  child.once('exit', resolve);
  child.kill('SIGTERM');
});
const waitFor = async (url, attempts = 50) => {
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

let socket;
let messageId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;

  pending.set(id, { reject, resolve });
  socket.send(JSON.stringify({ id, method, params }));
});

const press = async (key, code) => {
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
  { code: 'Digit8', key: '8', name: 'glows off' },
  { name: 'no blur', query: 'noBlur' },
  { name: 'no halos', query: 'noHalos' },
  { name: 'lamp on', lamp: true },
  { name: 'no beam', query: 'noBeam', lamp: true },
  { code: 'Digit7', key: '7', name: 'lighting off' },
  { name: 'no movement', query: 'noMovement' },
  { name: 'no collisions', query: 'noCollisions' },
  { code: 'Digit9', key: '9', name: 'physics off' },
];

try {
  launch(join(process.cwd(), 'node_modules/.bin/vite'), [
    '--host', host,
    '--port', String(gamePort),
    '--strictPort',
    '--mode', 'benchmark',
  ]);
  await waitFor(`http://${host}:${gamePort}`);

  launch(chrome, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=2880,1800',
    'about:blank',
  ]);
  const pages = await (await waitFor(`http://${host}:${debugPort}/json`)).json();
  const page = pages.find(({ type }) => type === 'page');

  if (!page) throw new Error('Chrome did not expose a page target');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);

    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
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

  for (const test of filter ? tests.filter(({ name }) => name.includes(filter)) : tests) {
    await send('Page.navigate', {
      url: `http://${host}:${gamePort}/?${test.query || ''}`,
    });
    await pause(warmup * 1000);
    for (let cycle = 0; cycle < (test.sky || 0); cycle++) await press('6', 'Digit6');
    if (test.lamp) await press('l', 'KeyL');
    if (test.key) await press(test.key, test.code);
    if (test.sky || test.lamp || test.key) await pause(1000);

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
  await rm(profile, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
}
