type Pose = {
  at: number;
  id: number;
  x: number;
  y: number;
  angle: number;
  rotation: number;
  speed: number;
  position: { x: number; y: number };
  [key: string]: number | { x: number; y: number };
};

type Frame = {
  at: number;
  now: number;
  poses: Pose[];
  entities: Pose[];
  [key: string]: any;
};

// CDP method replies and evaluated page values are heterogeneous JSON.
type CdpReply = Record<string, any>;
type Send = (method: string, params?: object) => Promise<CdpReply>;

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';

// Start the standard dev server pair first, as described in codebase-workflow.
const output = process.argv[2];
const delay = Number(process.argv[3] || 0);

assert(
  output,
  'Usage: node benchmarking/tools/input-response-browser.ts OUTPUT.json.gz',
);
const profile = await mkdtemp(join(tmpdir(), 'unicorn-remote-browser-'));
const connections: WebSocket[] = [];
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let chromeErrors = '';

chrome.stderr.on('data', (data) => {
  chromeErrors += data;
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connect = async (url: string) => {
  const socket = new WebSocket(url);

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let sequence = 0;

  const pending = new Map<
    number,
    {
      resolve: (reply: CdpReply) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  socket.on('message', (data) => {
    const message = JSON.parse((data as Buffer).toString());
    const request = pending.get(message.id);

    if (!request) return;
    pending.delete(message.id);

    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });

  const send: Send = (method, params = {}) =>
    new Promise<CdpReply>((resolve, reject) => {
      const id = ++sequence;

      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  connections.push(socket);
  return send;
};

const evaluate = async (send: Send, expression: string) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        JSON.stringify(result.exceptionDetails),
    );
  }

  return result.result.value;
};

try {
  let version;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      version = await (
        await fetch('http://127.0.0.1:9333/json/version')
      ).json();
      break;
    } catch {
      await pause(100);
    }
  }

  assert(version, chromeErrors);
  const browser = await connect(version.webSocketDebuggerUrl);
  const clients: Send[] = [];

  for (let index = 0; index < 2; index++) {
    const { browserContextId } = await browser('Target.createBrowserContext');

    const { targetId } = await browser('Target.createTarget', {
      url: 'http://localhost:3000/',
      browserContextId,
      newWindow: true,
    });

    const pages = await (await fetch('http://127.0.0.1:9333/json')).json();

    const send = await connect(
      pages.find(
        (page: { id: string; webSocketDebuggerUrl: string }) =>
          page.id === targetId,
      ).webSocketDebuggerUrl,
    );

    await send('Runtime.enable');
    await send('Page.enable');

    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    clients.push(send);
  }

  // Give the real app time to finish its intro and load every peer.
  await pause(7000);
  const activeIds = await Promise.all(
    clients.map((send: Send) =>
      evaluate(
        send,
        "(async()=>{window.loadedGameModule=name=>import(performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname.endsWith('/src/client/'+name)).name);const{network}=await window.loadedGameModule('network/network.ts');await network.ready;return network.shipId})()",
      ),
    ),
  );

  await Promise.all(
    clients.map((send: Send) =>
      evaluate(
        send,
        `(async()=>{
    const {network}=await window.loadedGameModule('network/network.ts');
    const {player}=await window.loadedGameModule('player.ts');
    if(player.ship.id!==network.shipId) throw Error('wrong game instance');
    const {game}=await window.loadedGameModule('game.ts'); const {setSizing}=await window.loadedGameModule('ui/set-sizing.ts'); game.size=5; setSizing(game);
    const socket=Reflect.get(network,'socket');
    if(${delay}) {const deliver=socket.onmessage, send=socket.send.bind(socket); socket.onmessage=event=>setTimeout(()=>deliver.call(socket,event),${delay}); socket.send=data=>setTimeout(()=>send(data),${delay});}
    const capture={shipId:network.shipId,frames:[]}; window.motionCapture=capture;
    const sample=network.remoteMotion.sample.bind(network.remoteMotion);
    let latest;
    network.remoteMotion.sample=options=>{
      const poses=sample(options);
      latest={at:performance.timeOrigin+options.now,tick:network.world.tick,
        poses:[...poses].filter(([id])=>${JSON.stringify(activeIds)}.includes(id)).map(([id,p])=>({id,x:p.position.x,y:p.position.y,rotation:p.rotation}))};
      return poses;
    };
    const record=()=>{if(latest&&capture.frames.at(-1)?.at!==latest.at) capture.frames.push(latest); if(!capture.finished) requestAnimationFrame(record)};
    requestAnimationFrame(record);
  })()`,
      ),
    ),
  );
  const key = (type: string, key: string) =>
    clients[0]('Input.dispatchKeyEvent', { type, key, code: key });

  // Turn in place so both ships stay inside each other's interest range.
  await pause(1000);

  const edges: { at: number; direction: string }[] = [];

  for (let i = 0; i < 16; i++) {
    const direction = i % 2 ? 'ArrowRight' : 'ArrowLeft';
    const previous = i % 2 ? 'ArrowLeft' : 'ArrowRight';

    await key('keyUp', previous);
    await key('keyDown', direction);

    edges.push({
      at: await evaluate(
        clients[0],
        'performance.timeOrigin+performance.now()',
      ),
      direction,
    });

    await pause(400 + (i % 3) * 73);
  }

  await key('keyUp', 'ArrowRight');
  await pause(500);

  for (let i = 0; i < clients.length; i++) {
    const shot = await clients[i]('Page.captureScreenshot', { format: 'png' });

    await writeFile(
      join(tmpdir(), `unicorn-response-${i}.png`),
      Buffer.from(shot.data, 'base64'),
    );
  }

  const results = await Promise.all(
    clients.map((send: Send) =>
      evaluate(
        send,
        'window.motionCapture.finished=true; window.motionCapture',
      ),
    ),
  );
  const pilot = activeIds[0];

  const series = results.map((r) =>
    r.frames.flatMap((f: Frame) => {
      const p = f.poses.find((p: Pose) => p.id === pilot);

      return p ? [{ ...p, at: f.at }] : [];
    }),
  );

  const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

  const sample = (frames: Frame[], at: number) => {
    const i = frames.findIndex((f: Frame) => f.at >= at);

    if (i < 1) return;
    const a = frames[i - 1],
      b = frames[i];

    return (
      a.rotation +
      (angle(b.rotation - a.rotation) * (at - a.at)) / (b.at - a.at)
    );
  };

  const start = edges[1].at,
    end = edges.at(-1).at;
  const fits = [];

  for (let lag = -30; lag <= 350; lag++) {
    const errors = series[0]
      .filter((f: Frame) => f.at >= start && f.at <= end)
      .flatMap((f: Frame) => {
        const remote = sample(series[1], f.at + lag);

        return remote === undefined ? [] : [angle(remote - f.rotation) ** 2];
      });

    fits.push({
      lagMs: lag,
      rmsRadians: Math.sqrt(
        errors.reduce((a: number, b: number) => a + b, 0) / errors.length,
      ),
    });
  }

  fits.sort((a, b) => a.rmsRadians - b.rmsRadians);

  const reversals = edges.slice(1).map((edge) => {
    const sign = edge.direction === 'ArrowRight' ? 1 : -1;

    const responses = series.map((frames: Frame[]) => {
      const i = frames.findIndex(
        (f: Frame, i: number) =>
          i > 0 &&
          f.at >= edge.at &&
          f.at < edge.at + 350 &&
          [0, 1, 2].every(
            (offset) =>
              frames[i + offset] &&
              sign *
                angle(
                  frames[i + offset].rotation - frames[i + offset - 1].rotation,
                ) >
                0.0001,
          ),
      );

      return i < 0 ? null : frames[i].at - edge.at;
    });

    return {
      ...edge,
      localMs: responses[0],
      remoteMs: responses[1],
      differenceMs:
        responses[1] === null || responses[0] === null
          ? null
          : responses[1] - responses[0],
    };
  });

  const firstResponseMs = series.map((frames: Frame[]) => {
    const initial = sample(frames, edges[0].at);

    return (
      frames.find(
        (f: Frame) =>
          f.at >= edges[0].at && Math.abs(angle(f.rotation - initial)) > 0.0001,
      ).at - edges[0].at
    );
  });

  const frameTiming = series.map((frames: Frame[]) => {
    const gaps = frames
      .slice(1)
      .map((f: Frame, i: number) => f.at - frames[i].at)
      .sort((a: number, b: number) => a - b);

    return {
      p95Ms: gaps[Math.floor(gaps.length * 0.95)],
      maxMs: Math.max(...gaps),
    };
  });

  const summary = {
    clients: 2,
    oneWayDelayMs: delay,
    firstResponseMs,
    frameTiming,
    fit: fits[0],
    zeroLag: fits.find((f) => f.lagMs === 0),
    reversals,
    frames: results.map((r) => r.frames.length),
  };

  await writeFile(
    output,
    gzipSync(JSON.stringify({ summary, edges, results }, null, 2)),
  );
  console.log(JSON.stringify(summary, null, 2));
  assert(
    Math.abs(summary.fit.lagMs) < 50 + 2 * delay,
    'remote steering must not add a playback buffer',
  );
  assert(
    Math.abs(firstResponseMs[1] - firstResponseMs[0]) < 50 + 2 * delay,
    'the first remote response must stay within network transit plus 50ms',
  );
  assert(
    results.every((result) =>
      result.frames
        .filter((frame: Frame) => frame.at >= start && frame.at <= end)
        .every((frame: Frame) =>
          frame.poses.some((pose: Pose) => pose.id === pilot),
        ),
    ),
    'both clients must retain the piloted ship throughout the steering sequence',
  );
  assert(
    series.every((s) => s.length > 300),
    'both real renderers must see the piloted ship',
  );
} finally {
  connections.forEach((socket) => socket.close());

  if (chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((resolve) => {
      chrome.once('exit', resolve);
      chrome.kill('SIGTERM');
    });
  }

  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
