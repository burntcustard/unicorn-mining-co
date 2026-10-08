import assert from 'node:assert/strict';
import { decodeBinarySnapshot } from '../../src/client/protocol/binary-snapshot';
import {
  decodeClientMessage,
  encodeServerControl,
} from '../../src/client/protocol/binary-control';
import { colors } from '../../src/specs/colors';
import { emptyPlayerInput } from '../../src/client/protocol/input';

class Writer {
  bytes: number[] = [];

  byte(value: number) {
    this.bytes.push(value);
  }

  number(value: number) {
    const bytes = new Uint8Array(8);

    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.bytes.push(...bytes);
  }

  numbers(values: number[]) {
    this.unsigned(values.length);
    values.forEach((value) => this.number(value));
  }

  outline(shapes: number[][]) {
    this.unsigned(shapes.length);
    shapes.forEach((shape) => this.numbers(shape));
  }

  packet() {
    return Uint8Array.from(this.bytes);
  }

  record(id: number, fields: [number, (() => void) | null][]) {
    this.unsigned(id);
    this.unsigned(fields.length);

    fields.forEach(([field, write]) => {
      this.unsigned(field * 2 + (write ? 0 : 1));
      write?.();
    });
  }

  string(value: string) {
    this.unsigned(value.length);

    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);

      this.byte(code & 255);
      this.byte(code >> 8);
    }
  }

  unsigned(value: number) {
    do {
      const digit = value % 128;

      value = Math.floor(value / 128);
      this.byte(digit | (value ? 128 : 0));
    } while (value);
  }
}

const start = (writer: Writer, flags: number, tick: number, nextId: number) => {
  writer.byte(0x55);
  writer.byte(0x4d);
  writer.byte(1);
  writer.byte(flags);
  writer.unsigned(tick);
  writer.unsigned(nextId);
};

// Exercise the nested schema, optional headers, clear tags, and JSON's number
// normalization against bytes assembled independently of the server writer.
{
  const writer = new Writer();

  start(writer, 31, 3, 10);
  writer.unsigned(11); // acknowledgedSequence
  writer.unsigned(5); // inputLead = -3 after zigzag decoding
  writer.unsigned(12); // snapshotSequence
  writer.unsigned(1);
  writer.unsigned(7); // entityIds
  writer.unsigned(1); // record count

  writer.record(7, [
    [
      1,
      () => {
        writer.unsigned(2);
        writer.byte(0);
        writer.number(4);
        writer.byte(1);

        writer.record(8, [
          [9, () => writer.byte(1)],
          [
            24,
            () => {
              writer.number(1);
              writer.number(2);
            },
          ],
        ]);
      },
    ],
    [5, null],
    [7, () => writer.number(Infinity)],
    [8, () => writer.numbers([-0, NaN, 2])],
    [9, () => writer.byte(2)],
    [10, () => writer.string('a\ud800b')],
    [
      17,
      () => {
        writer.unsigned(1);
        writer.byte(55); // id, health, shades, startup charge
        writer.number(3);
        writer.number(4);
        writer.number(5);
        writer.number(6);
        writer.unsigned(1);
        writer.string('blue');
        writer.number(0.7);
        writer.number(42);
        writer.unsigned(1);
        writer.number(1);
        writer.number(0.5);
      },
    ],
    [
      18,
      () => {
        writer.unsigned(1);
        writer.byte(7); // outline, fillShade, stroke
        writer.number(9);
        writer.number(2);
        writer.number(3);
        writer.number(8);
        writer.outline([[0, 1]]);
        writer.number(6);
        writer.unsigned(1);
        writer.outline([[2, 3]]);
      },
    ],
    [
      24,
      () => {
        writer.number(-0);
        writer.number(Infinity);
      },
    ],
    [
      30,
      () => {
        writer.unsigned(1);
        writer.numbers([4]);
        writer.number(5);
        writer.number(6);
        writer.number(7);
        writer.outline([[1, 2]]);
      },
    ],
  ]);

  const decoded = decodeBinarySnapshot(writer.packet());

  assert.deepEqual(decoded, {
    type: 'load',
    serverTick: 3,
    nextEntityId: 10,
    acknowledgedSequence: 11,
    inputLead: -3,
    snapshotSequence: 12,
    entityIds: [7],
    fullEntities: [
      {
        id: 7,
        cargoContents: [
          { moduleIndex: 4 },
          { id: 8, kind: 'item', position: { x: 1, y: 2 } },
        ],
        friction: null,
        health: null,
        hullHealth: [0, null, 2],
        kind: 'ship',
        label: 'a\ud800b',
        modules: [
          {
            type: 3,
            mount: 4,
            id: 5,
            health: 6,
            shades: ['blue'],
            chargeCooldown: 0.7,
            healthActivated: 42,
            segments: [{ active: 1, activationProgress: 0.5 }],
          },
        ],
        wreckage: [
          {
            radius: 9,
            offset: { x: 2, y: 3 },
            health: 8,
            shapeOutline: [[0, 1]],
            fillShade: 6,
            stroke: [[[2, 3]]],
          },
        ],
        position: { x: 0, y: null },
        segments: [
          {
            contents: [4],
            health: 5,
            mass: 6,
            maxHealth: 7,
            shapeOutline: [[1, 2]],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    decodeBinarySnapshot(writer.packet().buffer),
    decoded,
    'ArrayBuffer input has the same decoding result',
  );
  const padded = Uint8Array.from([0, ...writer.packet(), 0]);

  assert.deepEqual(decodeBinarySnapshot(padded.subarray(1, -1)), decoded);
  const unknownField = new Writer();

  start(unknownField, 0, 0, 1);
  unknownField.unsigned(1);
  unknownField.record(1, [[36, null]]);
  const duplicateField = new Writer();

  start(duplicateField, 0, 0, 1);
  duplicateField.unsigned(1);
  duplicateField.record(1, [
    [10, null],
    [10, null],
  ]);

  for (const invalid of [
    unknownField.packet(),
    duplicateField.packet(),
    Uint8Array.from([0]),
    Uint8Array.from([0x55, 0x4d, 2, 0, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 32, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 0, 0x80, 0, 1, 0]),
    writer.packet().subarray(0, writer.bytes.length - 1),
    Uint8Array.from([...writer.packet(), 0]),
  ]) {
    assert.throws(
      () => decodeBinarySnapshot(invalid),
      /Invalid binary snapshot/,
    );
  }
}

class Socket {
  binaryType = 'blob';
  closed: number[] = [];
  onmessage?: ({ data }: { data: string | ArrayBuffer | Uint8Array }) => void;
  onopen?: () => void;
  static OPEN = 1;
  readyState = Socket.OPEN;
  sent: Uint8Array[] = [];
  static sockets: Socket[] = [];

  close(code: number) {
    this.closed.push(code);
  }

  constructor() {
    Socket.sockets.push(this);
  }

  send(value: Uint8Array) {
    this.sent.push(value);
  }
}

let storedToken: string | null = 'malformed-token';
let tokenCleared = false;
const playerToken = '00000000-0000-4000-8000-000000000001';

Object.assign(globalThis, {
  WebSocket: Socket,
  localStorage: {
    getItem: () => storedToken,
    setItem: (_key: string, value: string) => (storedToken = value),
    removeItem: () => {
      storedToken = null;
      tokenCleared = true;
    },
  },
  location: { protocol: 'http:', host: 'localhost' },
});

const { NetworkClient } = await import('../../src/client/network/network');
const { playerInput } = await import('../../src/client/input/input');
const { createPlayerShip } =
  await import('../../src/client/objects/create-ship');
const { SearchLight, CargoHatch } =
  await import('../../src/client/objects/modules/index');
const client = new NetworkClient({ url: 'ws://test' });
const socket = Socket.sockets.at(-1)!;

assert.equal(socket.binaryType, 'arraybuffer');
socket.onopen?.();

assert.deepEqual(decodeClientMessage(socket.sent[0]), {
  type: 'hello',
  playerToken: null,
});

assert.equal(tokenCleared, true, 'malformed stored tokens are cleared');
assert.equal(storedToken, null);

socket.onmessage?.({
  data: encodeServerControl({
    type: 'welcome',
    playerToken,
    playerId: 1,
    shipId: 1,
    serverTick: 0,
    worldSeed: 2,
    spawn: { x: 0, y: 0 },
    unlockedPaints: 100,
    credits: 500,
  }),
});

const load = new Writer();

start(load, 19, 0, 3); // load, entityIds, snapshotSequence
load.unsigned(1); // snapshotSequence
load.unsigned(2);
load.unsigned(1);
load.unsigned(2);
load.unsigned(2); // full entity count

const position = (x: number, y: number) => {
  load.number(x);
  load.number(y);
};

load.record(1, [
  [9, () => load.byte(2)],
  [22, () => load.number(1)],
  [24, () => position(0, 0)],
  [25, () => load.number(25)],
  [28, () => load.number(0)],
  [29, () => load.number(0)],
]);
load.record(2, [
  [9, () => load.byte(4)],
  [10, () => load.string('before')],
  [24, () => position(10, 0)],
  [25, () => load.number(5)],
  [28, () => load.number(0)],
  [29, () => load.number(0)],
]);
socket.onmessage?.({ data: load.packet().buffer });
await client.ready;
assert.equal(client.connected, true);
assert.equal(client.player.credits, 500);
assert.deepEqual(
  [...client.player.unlockedPaints],
  [colors.yellow, colors.violet, colors.white],
);
assert(!Object.hasOwn(client.world.entities.get(1)!, 'credits'));

socket.onmessage?.({
  data: encodeServerControl({
    type: 'progress',
    unlockedPaints: 116,
    credits: 380,
  }),
});

assert.equal(client.player.credits, 380);
assert(client.player.unlockedPaints.includes(colors.cyan));
const unlockedPaints = client.player.unlockedPaints;

// A repeated authoritative mask must undo optimistic paint rewards too.
client.player.unlockedPaints.push(colors.red);

socket.onmessage?.({
  data: encodeServerControl({ type: 'progress', unlockedPaints: 116 }),
});

assert.equal(client.player.unlockedPaints, unlockedPaints);
assert(!client.player.unlockedPaints.includes(colors.red));
assert.equal(client.player.credits, 380);
assert.equal(storedToken, playerToken);
const reconnectClient = new NetworkClient({ url: 'ws://reconnect-test' });
const reconnectSocket = Socket.sockets.at(-1)!;

void reconnectClient;
reconnectSocket.onopen?.();

assert.deepEqual(decodeClientMessage(reconnectSocket.sent[0]), {
  type: 'hello',
  playerToken,
});

const authoritative = Reflect.get(client, 'authoritativeEntities') as Map<
  number,
  { label?: string; position: { x: number; y: number } }
>;

assert.equal(authoritative.get(2)?.label, 'before');

assert.deepEqual(decodeClientMessage(socket.sent.at(-1)!), {
  type: 'snapshotAck',
  sequence: 1,
});

const delta = new Writer();

start(delta, 16, 1, 3); // snapshotSequence, unchanged interest set
delta.unsigned(2);
delta.unsigned(1);

delta.record(2, [
  [10, null],
  [
    24,
    () => {
      delta.number(20);
      delta.number(0);
    },
  ],
]);

socket.onmessage?.({ data: delta.packet() });

assert.deepEqual(decodeClientMessage(socket.sent.at(-1)!), {
  type: 'snapshotAck',
  sequence: 2,
});

client.update({ input: emptyPlayerInput() });
assert.equal(authoritative.get(2)?.position.x, 20);
assert.equal(authoritative.get(2)?.label, undefined);
assert.equal(
  client.player.credits,
  380,
  'ship reconciliation does not overwrite the account',
);

socket.onmessage?.({
  data: JSON.stringify({
    type: 'snapshot',
    serverTick: 2,
    nextEntityId: 3,
    snapshotSequence: 3,
    fullEntities: [{ id: 2, label: 'JSON is invalid' }],
  }),
});

assert.deepEqual(socket.closed, [1007], 'JSON snapshots are rejected');
assert.equal(authoritative.get(2)?.label, undefined);

// A restored load must seed keyboard toggles before the first predicted input.
const restoredClient = new NetworkClient({ url: 'ws://restored-test' });
const receiveRestored = Reflect.get(restoredClient, 'receive').bind(
  restoredClient,
);

receiveRestored({
  message: {
    type: 'welcome',
    playerToken,
    playerId: 1,
    shipId: 1,
    serverTick: 0,
    worldSeed: 2,
    spawn: { x: 0, y: 0 },
  },
});

const savedShip = createPlayerShip(restoredClient.world, {
  id: 1,
  playerId: 1,
});

for (const active of [true, false]) {
  savedShip.setModuleActive({ module: SearchLight, active });
  savedShip.setModuleActive({ module: CargoHatch, active });
  playerInput.searchLight = !active;
  playerInput.cargoHatch = !active;

  receiveRestored({
    message: {
      type: 'load',
      serverTick: 0,
      nextEntityId: 10,
      entityIds: [1],
      fullEntities: [
        {
          id: 1,
          kind: 'ship',
          playerId: 1,
          position: { x: 0, y: 0 },
          radius: savedShip.radius,
          rotation: 0,
          spin: 0,
          hullHealth: savedShip.hullHealth,
          modules: savedShip.moduleStates,
        },
      ],
    },
  });

  assert.equal(playerInput.searchLight, active, 'load restores light toggle');
  assert.equal(playerInput.cargoHatch, active, 'load restores hatch toggle');
  restoredClient.update({ input: playerInput });
  const predictedShip = restoredClient.world.entities.get(
    1,
  ) as typeof savedShip;

  assert.equal(predictedShip.moduleActive({ module: SearchLight }), active);
  assert.equal(predictedShip.moduleActive({ module: CargoHatch }), active);
}

const malformedClient = new NetworkClient({ url: 'ws://malformed-test' });
const malformedSocket = Socket.sockets.at(-1)!;

void malformedClient;
malformedSocket.onmessage?.({ data: Uint8Array.of(0) });
assert.deepEqual(malformedSocket.closed, [1007]);

console.log(
  'Binary snapshots decode, reconcile, acknowledge, and reject malformed packets',
);
