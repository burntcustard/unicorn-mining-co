import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../src/shared/protocol/binary-control';
import { decodeBinarySnapshot } from '../src/shared/protocol/binary-snapshot';
import { emptyPlayerInput } from '../src/shared/protocol/input';

const address = process.argv[2] || 'http://127.0.0.1:3001';
const health = await fetch(new URL('/healthz', address));

assert.equal(health.status, 200);
assert.equal(await health.text(), 'ok');

const index = await fetch(new URL('/', address));

assert.equal(index.status, 200);
assert.match(await index.text(), /<html/);

const socket = new WebSocket(
  new URL('/game-socket', address).href.replace(/^http/, 'ws'),
  {
    origin: `https://${new URL(address).host}`,
  },
);
const timeout = setTimeout(() => socket.terminate(), 5000);
let welcomed = false;
let load = false;
let acknowledged = false;
let snapshots = 0;

try {
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => {
      socket.send(encodeClientMessage({ type: 'hello', playerToken: null }));
    });
    socket.on('error', reject);
    socket.on('close', (code) => {
      if (!acknowledged) reject(new Error(`WebSocket closed: ${code}`));
    });
    socket.on('message', (data, binary) => {
      assert(binary);
      const packet = new Uint8Array(data as Buffer);

      if (packet[0] === 0x55 && packet[1] === 0x43) {
        const welcome = decodeServerControl(packet);

        assert.equal(welcome.type, 'welcome');
        welcomed = true;
        socket.send(
          encodeClientMessage({
            type: 'input',
            tick: welcome.serverTick,
            sequence: 1,
            input: { ...emptyPlayerInput(), thrust: 1 },
          }),
        );
        return;
      }
      const snapshot = decodeBinarySnapshot(packet);

      snapshots++;
      load ||= snapshot.type === 'load';

      if (snapshot.snapshotSequence !== undefined) {
        socket.send(
          encodeClientMessage({
            type: 'snapshotAck',
            sequence: snapshot.snapshotSequence,
          }),
        );
      }
      acknowledged ||= snapshot.acknowledgedSequence === 1;

      if (welcomed && load && acknowledged && snapshots >= 2) resolve();
    });
  });
  console.log(
    `Go health, static client, WebSocket welcome, ${snapshots} UM snapshots, and input acknowledgement passed`,
  );
} finally {
  clearTimeout(timeout);
  socket.close();
}
