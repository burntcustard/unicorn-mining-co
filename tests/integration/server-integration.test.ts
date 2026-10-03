import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.js';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control';
import { decodeBinarySnapshot } from '../../src/client/protocol/binary-snapshot';
import { emptyPlayerInput } from '../../src/client/protocol/input';

// Exercise production-mangled field access and tags against the actual Go wire.
const entry = resolve('src/__wire_integration.ts');
const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'wire-fixture',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
        import {encodeClientMessage,decodeServerControl} from '${resolve('src/client/protocol/binary-control.ts')}';
        import {decodeBinarySnapshot} from '${resolve('src/client/protocol/binary-snapshot.ts')}';
        import {emptyPlayerInput} from '${resolve('src/client/protocol/input.ts')}';
        export default [
          token=>encodeClientMessage({type:'hello',playerToken:token}),
          tick=>encodeClientMessage({type:'input',tick,sequence:1,input:{...emptyPlayerInput(),thrust:1}}),
          sequence=>encodeClientMessage({type:'snapshotAck',sequence}),
          packet=>{const message=decodeServerControl(packet);return [message.type==='welcome',message.playerToken,message.playerId,message.shipId,message.serverTick];},
          packet=>{const message=decodeBinarySnapshot(packet);return [message.type==='load',message.snapshotSequence,message.acknowledgedSequence,message.serverTick,message.fullEntities.length];},
        ];`
          : undefined,
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const production = (
  await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  )
).default;
const source = [
  (playerToken: string | null) =>
    encodeClientMessage({ type: 'hello', playerToken }),
  (tick: number) =>
    encodeClientMessage({
      type: 'input',
      tick,
      sequence: 1,
      input: { ...emptyPlayerInput(), thrust: 1 },
    }),
  (sequence: number) => encodeClientMessage({ type: 'snapshotAck', sequence }),
  (packet: Uint8Array) => {
    const message = decodeServerControl(packet);

    assert.equal(message.type, 'welcome');
    return [
      true,
      message.playerToken,
      message.playerId,
      message.shipId,
      message.serverTick,
    ];
  },
  (packet: Uint8Array) => {
    const message = decodeBinarySnapshot(packet);

    return [
      message.type === 'load',
      message.snapshotSequence,
      message.acknowledgedSequence,
      message.serverTick,
      message.fullEntities.length,
    ];
  },
];

const sockets: WebSocket[] = [];
const server = spawn(resolve('bin/server'), [], {
  env: {
    ...process.env,
    PORT: '0',
    ASSET_DIR: resolve('dist'),
    APP_ENV: 'production',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server.kill('SIGTERM');
}, 15000);

try {
  const address = await new Promise<string>((resolveAddress, reject) => {
    let log = '';

    server.on('error', reject);
    server.once('exit', (code) =>
      reject(new Error(`Server exited before startup: ${code}\n${log}`)),
    );
    server.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/listening on .*:(\d+)/);

      if (match) resolveAddress(`http://127.0.0.1:${match[1]}`);
    });
  });
  const health = await fetch(`${address}/healthz`);

  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const index = await fetch(address);

  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const html = await index.text();
  const script = html.match(/src="([^"]+\.js)"/);

  assert(script, 'production index references a JavaScript chunk');
  const asset = await fetch(new URL(script[1], address));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.equal((await fetch(`${address}/missing`)).status, 404);

  const connect = async (codec: any[], token: string | null = null) => {
    const socket = new WebSocket(
      address.replace('http', 'ws') + '/game-socket',
      { origin: address.replace('http', 'https') },
    );

    sockets.push(socket);
    return new Promise<{ token: string; playerId: number; shipId: number }>(
      (resolveClient, reject) => {
        let welcome: any[];
        let received = 0;
        let acknowledged = false;
        let loadBytes = 0;
        let snapshotBytes = 0;

        socket.on('error', reject);
        socket.on('close', (code) => {
          if (received < 3 || !acknowledged) {
            reject(new Error(`Socket closed before snapshots: ${code}`));
          }
        });
        socket.on('open', () => socket.send(codec[0](token)));
        socket.on('message', (data, binary) => {
          try {
            assert(binary);
            const packet = new Uint8Array(data as Buffer);

            if (packet[1] === 0x43) {
              welcome = codec[3](packet);
              assert(welcome[0]);
              socket.send(codec[1](welcome[4]));
              return;
            }
            const snapshot = codec[4](packet);

            received++;

            if (snapshot[0]) loadBytes = packet.length;
            else snapshotBytes = packet.length;

            if (snapshot[1] !== undefined) socket.send(codec[2](snapshot[1]));
            acknowledged ||= snapshot[2] === 1;

            if (welcome && received >= 3 && acknowledged) {
              console.log(
                `Go ${codec === source ? 'source' : 'production'} codec: load ${loadBytes} B, snapshot ${snapshotBytes} B`,
              );
              socket.removeAllListeners('message');
              socket.close();
              resolveClient({
                token: welcome[1],
                playerId: welcome[2],
                shipId: welcome[3],
              });
            }
          } catch (error) {
            reject(error);
          }
        });
      },
    );
  };
  const first = await connect(source);

  await once(sockets.at(-1)!, 'close');
  const resumed = await connect(production, first.token);

  assert.equal(resumed.playerId, first.playerId);
  assert.equal(resumed.shipId, first.shipId);
  await once(sockets.at(-1)!, 'close');
  console.log(
    'Go assets, health, source/production UC+UM codecs, input acknowledgement and reconnect passed',
  );
} finally {
  clearTimeout(timeout);
  sockets.forEach((socket) => socket.terminate());

  if (server.exitCode === null) {
    const stopped = once(server, 'exit');

    server.kill('SIGTERM');
    await stopped;
  }
}
