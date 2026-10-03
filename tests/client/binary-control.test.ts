import assert from 'node:assert/strict';
import {
  decodeClientMessage,
  decodeServerControl,
  encodeClientMessage,
  encodeServerControl,
} from '../../src/client/protocol/binary-control';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import type { ClientMessage } from '../../src/client/protocol/network';

const token = '12345678-9abc-4def-8012-3456789abcde';

const controls: ClientMessage[] = [
  { type: 'hello', playerToken: null },
  { type: 'hello', playerToken: token },
  {
    type: 'input',
    tick: Number.MAX_SAFE_INTEGER,
    sequence: 2,
    input: { ...emptyPlayerInput(), hornDrill: true, thrust: 1, turn: -1 },
  },
  {
    type: 'input',
    tick: 3,
    sequence: 4,
    offset: 0.015,
    input: { ...emptyPlayerInput(), searchLight: true, turn: 1 },
  },
  { type: 'dock', action: 'buy', module: 2, moduleId: -1 },
  { type: 'dock', action: 'sell', objectIds: [-1, 2] },
  { type: 'dock', action: 'equip', moduleId: 4, mount: 3 },
  { type: 'dock', action: 'remove', mount: 2 },
  { type: 'dock', action: 'paint', paint: 3 },
  { type: 'dock', action: 'paint', paint: 4, moduleId: -5, mount: 2 },
  { type: 'dock', action: 'repair' },
  {
    type: 'dock',
    action: 'repair',
    moduleId: -Number.MAX_SAFE_INTEGER,
    mount: Number.MAX_SAFE_INTEGER,
  },
  { type: 'respawn' },
  { type: 'snapshotAck', sequence: Number.MAX_SAFE_INTEGER },
];

for (const message of controls) {
  const encoded = encodeClientMessage(message);
  const padded = Uint8Array.from([0, ...encoded, 0]);

  assert.deepEqual(decodeClientMessage(encoded), message);
  assert.deepEqual(decodeClientMessage(padded.subarray(1, -1)), message);
  assert.deepEqual(decodeClientMessage(encoded.buffer), message);
}

for (const message of [
  {
    type: 'welcome' as const,
    playerId: 2,
    playerToken: token,
    shipId: 7,
    serverTick: Number.MAX_SAFE_INTEGER,
    worldSeed: 8675309,
    spawn: { x: -1.25, y: 2.5 },
  },
  { type: 'respawn' as const, shipId: 8 },
]) {
  const encoded = encodeServerControl(message);

  assert.deepEqual(decodeServerControl(encoded), message);
  assert.deepEqual(decodeServerControl(encoded.buffer), message);
  assert.throws(() => decodeClientMessage(encoded), /Invalid binary control/);
}

const hello = encodeClientMessage({ type: 'hello', playerToken: null });

const input = encodeClientMessage({
  type: 'input',
  tick: 1,
  sequence: 1,
  input: emptyPlayerInput(),
});

const paint = encodeClientMessage({
  type: 'dock',
  action: 'paint',
  paint: 1,
  moduleId: 2,
});

const changed = (packet: Uint8Array, index: number, value: number) => {
  const copy = packet.slice();

  copy[index] = value;
  return copy;
};

for (const invalid of [
  Uint8Array.of(0),
  changed(hello, 0, 0),
  changed(hello, 2, 2),
  changed(hello, 3, 255),
  changed(hello, 4, 2), // invalid token marker
  Uint8Array.from([...hello, 0]), // trailing byte
  Uint8Array.from([0x55, 0x43, 1, 4, 0x80, 0]), // noncanonical varint
  changed(input, 6, 192), // invalid input control bits
  changed(input, 7, 2), // invalid offset marker
  changed(paint, 6, 4), // unknown optional field bit
  Uint8Array.from([0x55, 0x43, 1, 2, 1, 0]), // empty sell list
]) {
  assert.throws(() => decodeClientMessage(invalid), /Invalid binary control/);
}

assert.throws(
  () => encodeClientMessage({ type: 'hello', playerToken: 'bad' }),
  /Invalid binary control token/,
);
assert.throws(
  () => encodeClientMessage({ type: 'dock', action: 'sell', objectIds: [] }),
  /Invalid binary sell count/,
);

assert.throws(
  () =>
    encodeClientMessage({
      type: 'input',
      tick: 1,
      sequence: 1,
      offset: Infinity,
      input: emptyPlayerInput(),
    }),
  /Invalid binary input offset/,
);

assert.throws(() => decodeServerControl(hello), /Invalid binary control/);

console.log(
  'Binary client and server controls round-trip and reject invalid frames',
);
