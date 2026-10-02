import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';

// Start the standard dev server pair first, as described in codebase-workflow.
const output = process.argv[2];

assert(output, 'Usage: node benchmarking/remote-browser.mjs OUTPUT.json.gz');
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

  for (let index = 0; index < 4; index++) {
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
    clients.map((send, index) =>
      evaluate(
        send,
        `(async()=>{
    const {network}=await window.loadedGameModule('network.ts'); await network.ready; const {playerShip}=await window.loadedGameModule('player.ts'); if(playerShip.id!==network.shipId) throw Error('capture must instrument the rendered client');
    const {game}=await window.loadedGameModule('game.ts'); const {setSizing}=await window.loadedGameModule('set-sizing.ts');
    game.size=5; setSizing(game);
    const capture={shipId:network.shipId,frames:[],maxReceiveJump:0,maxSnapshotJump:0,snapshots:0,events:[],docking:[]}; window.motionCapture=capture;
    const motion=network.remoteMotion; const sample=motion.sample.bind(motion);
    const dockedTo=new Map([...network.world.entities].map(([id,entity])=>[id,entity.dockedTo]));
    const peers=poses=>[...poses].filter(([id])=>id!==network.shipId&&${JSON.stringify(activeIds)}.includes(id));
    const distance=(a,b)=>Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);
    const receive=Reflect.get(network,'receive').bind(network);
    Reflect.set(network,'receive', options=>{
      if(!['snapshot','load'].includes(options.message.type)) return receive(options);
      const now=options.now ?? performance.now(); options={...options,now}; const settings={now,world:network.world,predicted:network.predictFrame({now}),shipId:network.shipId};
      const before=sample(settings); const resets=new Set();
      for(const entity of options.message.fullEntities) {if(dockedTo.has(entity.id)&&dockedTo.get(entity.id)!==entity.dockedTo) resets.add(entity.id); dockedTo.set(entity.id,entity.dockedTo);}
      receive(options); const after=sample(settings);
      for(const [id,pose] of peers(before)) { const next=after.get(id); if(next&&resets.has(id)) capture.docking.push({id,now,jump:distance(pose,next),dockedTo:dockedTo.get(id)}); if(next&&!resets.has(id)&&distance(pose,next)<1000) {const jump=distance(pose,next); if(jump>capture.maxReceiveJump+1e-5) capture.events.push({kind:'receive',id,now,jump,pose,next}); capture.maxReceiveJump=Math.max(capture.maxReceiveJump,jump);} }
      capture.snapshots++;
    });
    const correct=motion.correct.bind(motion);
    motion.correct=options=>{
      correct(options); const after=sample(options);
      for(const [id,pose] of peers(options.before)) {
        const entity=network.world.entities.get(id); const next=after.get(id);
        if(next&&pose.dockedTo===entity?.dockedTo&&distance(pose,next)<1000) {const jump=distance(pose,next); if(jump>capture.maxSnapshotJump+1e-5) capture.events.push({kind:'correct',id,now:options.now,jump,pose,next}); capture.maxSnapshotJump=Math.max(capture.maxSnapshotJump,jump);}
      }
    };
    let latest;
    motion.sample=options=>{
      const result=sample(options);
      latest={at:options.now,tick:network.world.tick,poses:peers(result).map(([id,pose])=>({id,x:pose.position.x,y:pose.position.y,rotation:pose.rotation}))};
      return result;
    };
    const record=at=>{
      if(latest&&capture.frames.at(-1)?.at!==latest.at) capture.frames.push({...latest,rafAt:at});
      if(!capture.finished) requestAnimationFrame(record);
    }; requestAnimationFrame(record);
    const socket=Reflect.get(network,'socket'); const deliver=socket.onmessage; const send=socket.send.bind(socket);
    const delay=${40 + index * 15};
    socket.onmessage=event=>setTimeout(()=>deliver.call(socket,event),delay);
    socket.send=data=>setTimeout(()=>send(data),delay);
    return {shipId:network.shipId,delay};
  })()`,
      ),
    ),
  );

  for (const send of clients) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowUp',
      code: 'ArrowUp',
    });
  }
  await pause(3000);

  for (let index = 0; index < clients.length; index++) {
    await clients[index]('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: index % 2 ? 'ArrowRight' : 'ArrowLeft',
      code: index % 2 ? 'ArrowRight' : 'ArrowLeft',
    });
  }
  await pause(3000);

  for (let index = 0; index < clients.length; index++) {
    await clients[index]('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: index % 2 ? 'ArrowRight' : 'ArrowLeft',
      code: index % 2 ? 'ArrowRight' : 'ArrowLeft',
    });
    const screenshot = await clients[index]('Page.captureScreenshot', {
      format: 'png',
    });

    await writeFile(
      join(tmpdir(), `unicorn-remote-browser-${index}.png`),
      Buffer.from(screenshot.data, 'base64'),
    );
  }
  await pause(4000);

  for (const send of clients) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowUp',
      code: 'ArrowUp',
    });
  }
  await pause(1000);
  const results = await Promise.all(
    clients.map((send) =>
      evaluate(
        send,
        'window.motionCapture.finished=true; window.motionCapture',
      ),
    ),
  );
  const summaries = results.map((result) => {
    const gaps = result.frames
      .slice(1)
      .map((frame, i) => frame.rafAt - result.frames[i].rafAt)
      .sort((a, b) => a - b);
    const peerIds = [
      ...new Set(
        result.frames.flatMap((frame) => frame.poses.map((pose) => pose.id)),
      ),
    ];

    return {
      shipId: result.shipId,
      frames: result.frames.length,
      peerIds,
      snapshots: result.snapshots,
      maxReceiveJump: result.maxReceiveJump,
      maxSnapshotJump: result.maxSnapshotJump,
      p95FrameMs: gaps[Math.floor(gaps.length * 0.95)],
      maxFrameMs: Math.max(...gaps),
      fps: (1000 * gaps.length) / gaps.reduce((sum, gap) => sum + gap, 0),
    };
  });

  await writeFile(
    output,
    gzipSync(
      JSON.stringify(
        {
          date: new Date().toISOString(),
          browser: version.Browser,
          renderer: 'real development canvas app',
          clients: 4,
          bidirectionalDelayMs: [40, 55, 70, 85],
          summaries,
          results,
        },
        null,
        2,
      ) + '\n',
      { level: 9 },
    ),
  );
  console.log(JSON.stringify(summaries, null, 2));
  assert(
    summaries.every((value) => value.peerIds.length === 3),
    'every browser must observe the other three players',
  );
  assert(
    summaries.every(
      (value) => value.maxReceiveJump < 1e-5 && value.maxSnapshotJump < 1e-5,
    ),
    'browser snapshot continuity',
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
