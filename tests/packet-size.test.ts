import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import WebSocket, { type RawData } from 'ws';
import { GameServer } from '../src/server/game-server';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { buildPlugin } from '../plugins/build-plugins.js';
import { encodeProtocolTags } from '../plugins/protocol-tags.js';

const serverCode = readFileSync('dist/server.js', 'utf8');

assert(
  !/\b(lowerBound|upperBound|advance|resource|station|snapshot|respawn|cargoHatch|hornDrill|searchLight|shieldGenerator)\b/.test(
    serverCode,
  ),
  'audited properties and wire tags must be short in the built server',
);

assert(
  !/\b(?:_?outline|_?shapeOutline)\b/.test(serverCode),
  'shape outline fields must receive short production names',
);
assert(
  !/\b(?:textOutline|Path2D)\b/.test(serverCode),
  'client text drawing must stay out of the server bundle',
);

const entryId = resolve('src/__packet_client_test.ts');
const entry = `
import { emptyPlayerInput, packPlayerInput } from './shared/protocol/input';
export const hello = () => JSON.stringify({ type: 'hello', playerToken: null });
export const makeInput = (tick, offset, active = false) => JSON.stringify([
  tick,
  active ? 2 : 1,
  packPlayerInput(active
    ? { ...emptyPlayerInput(), hornDrill: true, thrust: 1, turn: -1 }
    : emptyPlayerInput()),
  ...(offset === undefined ? [] : [offset]),
]);
export const inspect = source => {
  const message = JSON.parse(source);
  return [message.type, message.shipId, message.serverTick, message.fullEntities?.length, message.acknowledgedSequence];
};
export const entityIds = source => {
  const message = JSON.parse(source);
  return [message.entityIds, message.fullEntities?.map(entity => entity.id)];
};
`;
const bundle = await rolldown({
  input: entryId,
  plugins: [
    {
      name: 'packet-client-fixture',
      resolveId: (id) => (id === entryId ? entryId : undefined),
      load: (id) => (id === entryId ? entry : undefined),
    },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});
const { output } = await bundle.generate({ format: 'esm', minify: true });

await bundle.close();
const chunk = output.find((item) => item.type === 'chunk');

assert(chunk);
const client = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
);

const sourceOf = (data: RawData) =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(
        data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      ).toString('utf8');

const receive = (socket: WebSocket) => {
  const packets: string[] = [];

  socket.on('message', (data) => packets.push(sourceOf(data)));
  return packets;
};
const waitFor = async (
  packets: string[],
  type: string,
  accept: (source: string) => boolean = () => true,
) => {
  const started = Date.now();

  while (Date.now() - started < 3000) {
    const packet = packets.find(
      (source) =>
        client.inspect(source)[0] === encodeProtocolTags.get(type) &&
        accept(source),
    );

    if (packet) return packet;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw Error(`Timed out waiting for ${type}`);
};

const sourceServer = new GameServer({ port: 0, worldSeed: 8675309 });
const listener = sourceServer.start();

await once(listener, 'listening');
const sourceAddress = listener.address();

assert(sourceAddress && typeof sourceAddress !== 'string');
const sourceSocket = new WebSocket(
  `ws://127.0.0.1:${sourceAddress.port}/game-socket`,
);
const sourcePackets: string[] = [];

sourceSocket.on('message', (data) => sourcePackets.push(sourceOf(data)));

let plainLoad: string;
let plainSnapshot: string;
let plainWelcome: string;

try {
  await once(sourceSocket, 'open');
  sourceSocket.send(JSON.stringify({ type: 'hello', playerToken: null }));
  const started = Date.now();

  while (
    !sourcePackets.some((source) => JSON.parse(source).type === 'welcome') ||
    !sourcePackets.some((source) => JSON.parse(source).type === 'load') ||
    !sourcePackets.some((source) => JSON.parse(source).type === 'snapshot')
  ) {
    assert(Date.now() - started < 3000, 'source server timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  plainWelcome = sourcePackets.find(
    (source) => JSON.parse(source).type === 'welcome',
  )!;
  plainLoad = sourcePackets.find(
    (source) => JSON.parse(source).type === 'load',
  )!;
  plainSnapshot = sourcePackets.find(
    (source) => JSON.parse(source).type === 'snapshot',
  )!;
} finally {
  sourceSocket.close();
  await sourceServer.stop();
}

const probe = createServer();

probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const address = probe.address();

assert(address && typeof address !== 'string');
await new Promise<void>((done) => probe.close(() => done()));
const child = spawn(
  process.execPath,
  ['dist/server.js', '--port', String(address.port)],
  {
    env: { ...process.env, WORLD_SEED: '8675309' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const childExit = once(child, 'exit');
let serverError = '';

child.stderr.on('data', (data) => (serverError += sourceOf(data)));

try {
  await Promise.race([
    new Promise<void>((done, reject) => {
      child.stdout.on('data', (data) => {
        if (sourceOf(data).includes('Game server listening')) done();
      });
      child.once('exit', (code) =>
        reject(Error(`Built server exited ${code}: ${serverError}`)),
      );
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error('Built server timed out')), 3000),
    ),
  ]);

  const origin = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${origin}/healthz`);
  const page = await fetch(origin);
  const html = await page.text();
  const entry = html.match(/src="\.\/(index-[^" ]+\.js)"/)?.[1];

  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  assert.equal(page.status, 200);
  assert(html.includes('connection-status'));
  assert(entry, 'built HTML names its entry chunk');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const script = await fetch(`${origin}/${entry}`);

  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') || '', /javascript/);
  assert.match(script.headers.get('cache-control') || '', /immutable/);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/server.js`)).status, 404);
  const www = await new Promise<{ status: number; location?: string }>(
    (resolve, reject) => {
      const probe = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/',
          headers: { Host: 'www.unicorn-mining.co' },
        },
        (response) => {
          response.resume();
          response.on('end', () =>
            resolve({
              status: response.statusCode!,
              location: response.headers.location,
            }),
          );
        },
      );

      probe.on('error', reject);
      probe.end();
    },
  );

  assert.equal(www.status, 308);
  assert.equal(www.location, 'https://unicorn-mining.co/');

  const rejectedSocket = new WebSocket(
    `ws://127.0.0.1:${address.port}/game-socket`,
    { origin: 'https://elsewhere.example' },
  );
  const rejectionCode = await Promise.race([
    new Promise<string | undefined>((resolve, reject) => {
      rejectedSocket.once('error', (error: NodeJS.ErrnoException) =>
        resolve(error.code),
      );
      rejectedSocket.once('open', () => reject(Error('Unexpected upgrade')));
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error('Rejected upgrade timed out')), 3000),
    ),
  ]);

  assert.equal(rejectionCode, 'ECONNRESET');
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);
  const packets = receive(socket);

  try {
    await once(socket, 'open');
    const compactHello = client.hello();

    socket.send(compactHello);
    const welcome = await waitFor(packets, 'welcome');
    const load = await waitFor(packets, 'load');
    const snapshot = await waitFor(packets, 'snapshot');
    const distantSnapshot = await waitFor(
      packets,
      'snapshot',
      (source) =>
        client.inspect(source)[2] > client.inspect(snapshot)[2] &&
        client.inspect(source)[2] % 4 === 0,
    );
    const inputTick = client.inspect(distantSnapshot)[2] + 10;
    const compactInput = client.makeInput(inputTick);
    const timedInput = client.makeInput(inputTick, 0.015);
    const activeInput = client.makeInput(inputTick + 10, 0.015, true);
    const plainInputMessage = {
      type: 'input',
      tick: inputTick,
      sequence: 1,
      input: emptyPlayerInput(),
    };
    const plainInput = JSON.stringify(plainInputMessage);
    const sizes = {
      hello: [
        Buffer.byteLength(compactHello),
        Buffer.byteLength(JSON.stringify({ type: 'hello', playerToken: null })),
      ],
      input: [Buffer.byteLength(compactInput), Buffer.byteLength(plainInput)],
      inputTimed: [
        Buffer.byteLength(timedInput),
        Buffer.byteLength(
          JSON.stringify({ ...plainInputMessage, offset: 0.015 }),
        ),
      ],
      inputActive: [
        Buffer.byteLength(activeInput),
        Buffer.byteLength(
          JSON.stringify({
            ...plainInputMessage,
            tick: inputTick + 10,
            sequence: 2,
            offset: 0.015,
            input: {
              ...emptyPlayerInput(),
              hornDrill: true,
              thrust: 1,
              turn: -1,
            },
          }),
        ),
      ],
      welcome: [Buffer.byteLength(welcome), Buffer.byteLength(plainWelcome)],
      load: [Buffer.byteLength(load), Buffer.byteLength(plainLoad)],
      snapshot: [Buffer.byteLength(snapshot), Buffer.byteLength(plainSnapshot)],
    };

    socket.send(timedInput);
    await waitFor(
      packets,
      'snapshot',
      (source) => client.inspect(source)[4] === 1,
    );
    socket.send(activeInput);
    await waitFor(
      packets,
      'snapshot',
      (source) => client.inspect(source)[4] === 2,
    );
    console.log(
      Object.entries(sizes)
        .map(([type, [compact, plain]]) => `${type}: ${compact}/${plain}B`)
        .join(', '),
    );
    assert(client.inspect(load)[3] > 0, 'mangled client reads server entities');
    const [loadIds, visibleIds] = client.entityIds(load);
    const [snapshotIds, recordIds] = client.entityIds(snapshot);

    assert.equal(loadIds, undefined, 'load IDs come from full records');
    assert.equal(snapshotIds, undefined, 'unchanged visibility omits IDs');
    assert(recordIds.length > 0);
    assert(
      recordIds.every(
        (id: unknown) => typeof id === 'number' && visibleIds.includes(id),
      ),
      'mangled client reads every compact server entity ID',
    );
    assert(sizes.hello[0] < sizes.hello[1]);
    assert(sizes.input[0] < sizes.input[1] * 0.2);
    assert(Array.isArray(JSON.parse(compactInput)));
    assert(!activeInput.includes('false'), 'active controls use a bitmask');
    assert(sizes.inputTimed[0] < sizes.inputTimed[1] * 0.25);
    assert(sizes.inputActive[0] < sizes.inputActive[1] * 0.25);
    assert(sizes.welcome[0] < sizes.welcome[1]);
    assert(sizes.welcome[0] <= 120, 'welcome keeps whole-number coordinates');
    assert(sizes.load[0] < sizes.load[1] * 0.9);
    assert(
      sizes.load[0] < 4_500,
      'defaults and procedural geometry stay off the wire',
    );
    assert(sizes.snapshot[0] < 1_800, 'all entity snapshots send deltas');
    assert(
      Buffer.byteLength(distantSnapshot) < 2_500,
      'distant-tier snapshots stay compact too',
    );
  } finally {
    socket.close();
  }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await childExit;
}
