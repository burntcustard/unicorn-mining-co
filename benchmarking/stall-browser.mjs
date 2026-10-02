import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';

// Start the standard dev server pair first, as described in codebase-workflow.
const output = process.argv[2];
const delay = Number(process.argv[3] || 5);
const mode = process.argv[4] || 'network';
const serverPid = Number(process.argv[5]);
let serverStopped = false;

assert(['network', 'server', 'client'].includes(mode));
assert(mode !== 'server' || (Number.isInteger(serverPid) && serverPid > 1));

assert(
  output,
  'Usage: node benchmarking/stall-browser.mjs OUTPUT.json.gz DELAY_MS MODE [SERVER_PID]',
);
const profile = await mkdtemp(join(tmpdir(), 'unicorn-remote-browser-'));
const connections = [];
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connect = async (url) => {
  const socket = new WebSocket(url);

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let sequence = 0;
  const pending = new Map();

  socket.on('message', (data) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);

    if (!request) return;
    pending.delete(message.id);

    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;

      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  connections.push(socket);
  return send;
};
const evaluate = async (send, expression) => {
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
  const clients = [];

  for (let index = 0; index < 2; index++) {
    const { browserContextId } = await browser('Target.createBrowserContext');
    const { targetId } = await browser('Target.createTarget', {
      url: 'http://localhost:3000/',
      browserContextId,
      newWindow: true,
    });
    const pages = await (await fetch('http://127.0.0.1:9333/json')).json();
    const send = await connect(
      pages.find((page) => page.id === targetId).webSocketDebuggerUrl,
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
    clients.map((send) =>
      evaluate(
        send,
        "(async()=>{window.loadedGameModule=name=>import(performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname.endsWith('/src/client/'+name)).name);const{network}=await window.loadedGameModule('network.ts');await network.ready;return network.shipId})()",
      ),
    ),
  );

  await Promise.all(
    clients.map((send) =>
      evaluate(
        send,
        `(async()=>{
    const {network}=await window.loadedGameModule('network.ts');
    const {playerShip}=await window.loadedGameModule('player.ts');
    if(playerShip.id!==network.shipId) throw Error('wrong game instance');
    const {game}=await window.loadedGameModule('game.ts'); const {setSizing}=await window.loadedGameModule('set-sizing.ts'); game.size=5; setSizing(game);
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
  const key = (send, type, key) =>
    send('Input.dispatchKeyEvent', { type, key, code: key });

  await Promise.all(clients.map((send) => key(send, 'keyDown', 'ArrowUp')));
  await pause(3000);
  const start = await evaluate(
    clients[0],
    'performance.timeOrigin+performance.now()',
  );

  if (mode === 'network') {
    await evaluate(
      clients[0],
      `(async()=>{
      const {network}=await window.loadedGameModule('network.ts');
      const socket=Reflect.get(network,'socket');
      const receive=socket.onmessage, send=socket.send.bind(socket), incoming=[], outgoing=[];
      socket.onmessage=event=>incoming.push(event); socket.send=data=>outgoing.push(data);
      window.releaseNetwork=()=>{socket.onmessage=receive; socket.send=send; incoming.forEach(event=>receive.call(socket,event)); outgoing.forEach(data=>send(data));};
    })()`,
    );
  }

  if (mode === 'server') {
    process.kill(serverPid, 'SIGSTOP');
    serverStopped = true;
  }

  if (mode === 'client') {
    await evaluate(
      clients[0],
      '(()=>{const end=performance.now()+1100;while(performance.now()<end){};return true})()',
    );
  } else {
    await pause(250);
    await key(clients[0], 'keyDown', 'ArrowRight');
    await pause(300);
    await key(clients[0], 'keyUp', 'ArrowRight');
    await pause(550);
  }

  if (mode === 'server') {
    process.kill(serverPid, 'SIGCONT');
    serverStopped = false;
  }

  if (mode === 'network') await evaluate(clients[0], 'window.releaseNetwork()');
  const end = await evaluate(
    clients[0],
    'performance.timeOrigin+performance.now()',
  );

  await pause(2500);
  const results = await Promise.all(
    clients.map((send) =>
      evaluate(
        send,
        'window.motionCapture.finished=true; window.motionCapture',
      ),
    ),
  );

  await Promise.all(clients.map((send) => key(send, 'keyUp', 'ArrowUp')));

  for (let i = 0; i < clients.length; i++) {
    const shot = await clients[i]('Page.captureScreenshot', { format: 'png' });

    await writeFile(
      join(tmpdir(), `unicorn-stall-${mode}-${i}.png`),
      Buffer.from(shot.data, 'base64'),
    );
  }
  const summary = results.map((result, index) => {
    const frames = result.frames.filter(
      (frame) => frame.at >= start - 500 && frame.at < end + 2400,
    );
    const pilot = frames.map((frame) => ({
      ...frame.poses.find((pose) => pose.id === activeIds[0]),
      at: frame.at,
    }));
    const advances = pilot.slice(1).map((pose, i) => {
      const previous = pilot[i],
        dt = (pose.at - previous.at) / 1000;

      return {
        at: pose.at,
        dt,
        distance: Math.hypot(pose.x - previous.x, pose.y - previous.y),
        speed: Math.hypot(pose.x - previous.x, pose.y - previous.y) / dt,
        spin:
          Math.abs(
            Math.atan2(
              Math.sin(pose.rotation - previous.rotation),
              Math.cos(pose.rotation - previous.rotation),
            ),
          ) / dt,
      };
    });

    return {
      index,
      frames: frames.length,
      missing: pilot.filter((pose) => pose.id === undefined).length,
      freezes: advances.filter((frame) => frame.speed < 5).length,
      maxSpeed: Math.max(...advances.map((frame) => frame.speed)),
      maxSpin: Math.max(...advances.map((frame) => frame.spin)),
      gaps: advances.filter((frame) => frame.dt > 0.2),
      maxFrameMs: Math.max(...advances.map((frame) => frame.dt * 1000)),
    };
  });

  await writeFile(
    output,
    gzipSync(
      JSON.stringify({
        mode,
        oneWayDelayMs: delay,
        start,
        end,
        summary,
        results,
      }),
    ),
  );
  console.log(JSON.stringify({ mode, oneWayDelayMs: delay, summary }, null, 2));
  assert(
    summary.every((result) => result.missing === 0 && result.frames > 100),
    'both screens must retain the piloted ship',
  );
  assert.equal(
    summary[0].freezes,
    0,
    'the pilot must keep moving through the outage and recovery',
  );
  assert(
    summary[0].maxSpeed < 400,
    'recovery must not create a high-speed position snap',
  );
  assert(summary[0].maxSpin < 8, 'recovery must not create an angular snap');

  if (mode === 'client') {
    assert(
      summary[0].gaps.length === 1 && summary[0].gaps[0].distance > 150,
      'the first frame after a blocked main thread must catch up movement',
    );
  }
} finally {
  if (serverStopped) process.kill(serverPid, 'SIGCONT');
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
