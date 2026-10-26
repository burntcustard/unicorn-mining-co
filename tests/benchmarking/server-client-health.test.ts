import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { ProtocolClient } from '../../benchmarking/server/client.ts';
import * as Vec from '../../src/client/utilities/vector.ts';

const cachedClient = (readyState: number = WebSocket.OPEN) => {
  const socket = { readyState };

  const client = Object.assign(Object.create(ProtocolClient.prototype), {
    options: { index: 3 },
    socket,
    errors: [],
    closedUnexpectedly: false,
    welcomed: true,
    measuring: false,
    shipId: 1,
    requiredModules: [],
    entities: new Map([
      [
        1,
        {
          id: 1,
          kind: 'ship',
          position: Vec.create(),
          velocity: Vec.create(80, 0),
          rotation: 0,
          spin: 0,
          radius: 40,
        },
      ],
    ]),
  }) as ProtocolClient;

  return { client, socket };
};

test('a cached ready ship cannot complete preparation after an abnormal close', async () => {
  const { client } = cachedClient(WebSocket.CLOSED);

  client.errors.push('Unexpected WebSocket close 1006');
  client.closedUnexpectedly = true;
  assert(client.measurementReady('convoy', []));

  let evaluated = false;

  await assert.rejects(
    client.until(() => {
      evaluated = true;
      return true;
    }, 'Waiting for the cached ship'),
    /Protocol client 3: Unexpected WebSocket close 1006/,
  );

  assert(!evaluated);
});

test('protocol errors and socket state prevent measurement before callbacks settle', () => {
  for (const state of [WebSocket.CLOSING, WebSocket.CLOSED]) {
    const { client } = cachedClient(state);

    assert.throws(() => client.assertHealthy(), /WebSocket is not open/);
    assert.throws(() => client.start(), /WebSocket is not open/);
    assert(!client.measuring);
  }

  const { client } = cachedClient();

  client.errors.push('Invalid binary message');
  assert.throws(() => client.assertHealthy(), /Invalid binary message/);
  client.errors.length = 0;
  client.closedUnexpectedly = true;
  assert.throws(() => client.assertHealthy(), /Unexpected WebSocket close/);
});

test('initial connection setup is permitted explicitly while ready connections stay open', async () => {
  const { client } = cachedClient(WebSocket.CONNECTING);

  assert.throws(() => client.assertHealthy(), /WebSocket is not open/);
  assert.doesNotThrow(() => client.assertHealthy({ allowConnecting: true }));

  const { client: connected } = cachedClient();

  await connected.until(() => true, 'Already connected');
  assert.doesNotThrow(() => connected.assertHealthy());
});

test('preparation stops when its connection closes between condition polls', async () => {
  const { client, socket } = cachedClient();

  await assert.rejects(
    client.until(() => {
      socket.readyState = WebSocket.CLOSED;
      return false;
    }, 'Waiting for progress'),
    /WebSocket is not open/,
  );
});
