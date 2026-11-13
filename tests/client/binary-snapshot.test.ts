import assert from 'node:assert/strict';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
  BinaryField,
} from '../../src/client/protocol/binary-snapshot';
import {
  decodeClientMessage,
  encodeServerControl,
  decodeServerControl,
} from '../../src/client/protocol/binary-control';
import { colors, paintColors } from '../../src/specs/colors';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import { maxPredictionTicks } from '../../src/specs/prediction';
import { simulationStep } from '../../src/specs/simulation';

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

// Construct packed motion independently, including alternating widths that
// reuse the decoder's scratch buffer.
{
  const writer = new Writer();

  const packed = (value: number, omitted: number) => {
    const number = new Writer();

    number.number(value);
    number.bytes.slice(omitted).forEach((byte) => writer.byte(byte));
  };

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      BinaryField.packedPosition,
      () => {
        packed(-3000.25, 2);
        packed(6300.75, 2);
      },
    ],
    [BinaryField.packedRotation, () => packed(0.75, 3)],
    [
      BinaryField.packedVelocity,
      () => {
        packed(2 ** -24, 2);
        packed(-1, 2);
      },
    ],
    [BinaryField.packedSpin, () => packed(-(2 ** -24), 3)],
  ]);

  const entity = decodeBinarySnapshot(writer.packet()).fullEntities[0];

  assert.deepEqual(entity.position, { x: -3000.25, y: 6300.75 });
  assert.deepEqual(entity.velocity, { x: 2 ** -24, y: -1 });
  assert.equal(entity.rotation, 0.75);
  assert.equal(entity.spin, -(2 ** -24));
}

for (const [field, bytes] of [
  [BinaryField.packedPosition, 11],
  [BinaryField.packedRotation, 4],
] as const) {
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      field,
      () => {
        for (let i = 0; i < bytes; i++) writer.byte(0);
      },
    ],
  ]);

  assert.throws(
    () => decodeBinarySnapshot(writer.packet()),
    /Invalid binary snapshot/,
  );
}

{
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      BinaryField.packedRotation,
      () => {
        for (let i = 0; i < 5; i++) writer.byte(0);
      },
    ],
    [BinaryField.rotation, () => writer.number(0)],
  ]);

  assert.throws(
    () => decodeBinarySnapshot(writer.packet()),
    /Invalid binary snapshot/,
  );
}

// Exercise the nested schema, optional headers, clear tags, and JSON's number
// normalization against bytes assembled independently of the server writer.
{
  const writer = new Writer();

  start(writer, 63, 3, 10);
  writer.unsigned(11); // acknowledgedSequence
  writer.unsigned(5); // inputLead = -3 after zigzag decoding
  writer.unsigned(12); // snapshotSequence
  writer.unsigned(7); // acknowledgedDockSequence
  writer.number(1234); // credits
  writer.unsigned(1); // dock ID mappings
  writer.unsigned(1); // signed -1
  writer.unsigned(84); // signed 42
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
    [45, () => writer.number(5)],
    [
      17,
      () => {
        writer.unsigned(2);
        writer.byte(55); // id, health, shades, startup charge
        writer.unsigned(6);
        writer.unsigned(8);
        writer.unsigned(10);
        writer.number(6);
        writer.byte(0); // red palette
        writer.number(0.7);
        writer.number(42);
        writer.unsigned(1);
        writer.byte(9);
        writer.number(0.5);
      },
    ],
    [
      18,
      () => {
        writer.unsigned(1);
        writer.byte(15); // outline, fillShade, stroke, color
        writer.number(9);
        writer.number(2);
        writer.number(3);
        writer.number(8);
        writer.outline([[0, 1]]);
        writer.number(6);
        writer.string('#fa3');
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
    acknowledgedDockSequence: 7,
    credits: 1234,
    dockIds: [[-1, 42]],
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
        name: 'a\ud800b',
        blockedBeams: 5,
        modules: [
          {
            type: 3,
            mount: 4,
            id: 5,
            health: 6,
            shades: colors.red,
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
            color: '#fa3',
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
  unknownField.record(1, [[48, null]]);
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
    Uint8Array.from([0x55, 0x4d, 1, 64, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 128, 0, 1, 0]),
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

for (const positions of [[], [{ x: -2999, y: 3.5 }]]) {
  const radar = new Writer();

  start(radar, 64, 0, 1);
  radar.unsigned(positions.length);

  positions.forEach(({ x, y }) => {
    radar.number(x);
    radar.number(y);
  });

  radar.unsigned(0);
  const decoded = decodeBinarySnapshot(radar.packet());

  assert.deepEqual(decoded.asteroidPositions, positions);
  assert.deepEqual(
    decoded.fullEntities,
    [],
    'radar coordinates contain no entity model',
  );
  assert.throws(() => decodeBinarySnapshot(radar.packet().subarray(0, -1)));
}

const invalidRadar = new Writer();

start(invalidRadar, 64, 0, 1);
invalidRadar.unsigned(1);
invalidRadar.number(Infinity);
invalidRadar.number(0);
invalidRadar.unsigned(0);
assert.throws(
  () => decodeBinarySnapshot(invalidRadar.packet()),
  /Invalid binary snapshot/,
);

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
client.sendActivity({ now: 0 });
assert.equal(
  socket.sent.length,
  0,
  'disconnected clients do not send activity',
);
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
    unlockedPaints: 486,
    credits: 500,
  }),
});

const load = new Writer();

start(load, 83, 0, 3); // load, entityIds, snapshotSequence, asteroid positions
load.unsigned(1); // snapshotSequence
load.unsigned(1);
load.number(2999);
load.number(-4);
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
  [41, () => load.number(-1.25)],
  [42, () => load.number(987)],
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
assert.deepEqual(client.asteroidPositions, [{ x: 2999, y: -4 }]);
assert.equal(
  client.world.entities.size,
  2,
  'radar positions do not instantiate world entities',
);
const hydratedShip = client.world.entities.get(1);

assert.equal(
  hydratedShip.transitTime,
  -1.25,
  'wire transit timer reaches the live ship',
);
assert.equal(hydratedShip.transitGate, 987);

const worldSounds = [0, 1, 2, 3, 4, 5, 6, 7, 9].map((effect) => ({
  effect,
  id: -130,
  by: 2,
  position: { x: -400.25, y: 250.5 },
}));

const soundsPacket = encodeServerControl({
  type: 'sounds',
  sounds: worldSounds,
});

assert.deepEqual(decodeServerControl(soundsPacket), {
  type: 'sounds',
  sounds: worldSounds,
});

socket.onmessage?.({ data: soundsPacket });
assert.deepEqual(
  client.takeSounds(),
  worldSounds,
  'network delivers every gameplay sound, including remote actions',
);
assert.deepEqual(
  client.takeSounds(),
  [],
  'taking sounds consumes the packet exactly once',
);

assert.throws(
  () =>
    encodeServerControl({
      type: 'sounds',
      sounds: [{ ...worldSounds[0], effect: 8 }],
    }),
  'UI bleeps cannot enter the multiplayer stream',
);

const invalidSoundPacket = soundsPacket.slice();

invalidSoundPacket[5] = 8;
assert.throws(
  () => decodeServerControl(invalidSoundPacket),
  'remote UI sound packets are rejected',
);
assert.throws(
  () => decodeServerControl(soundsPacket.slice(0, -1)),
  'truncated sound packets are rejected',
);
assert.equal(client.player.credits, 500);
assert.deepEqual(
  [...client.player.unlockedPaints],
  [1, 2, 5, 6, 7, 8].flatMap((index) =>
    paintColors[index] ? [paintColors[index]] : [],
  ),
  'unlock bits select listed paints and preserve absent-paint compatibility',
);

socket.onmessage?.({
  data: encodeServerControl({
    type: 'progress',
    unlockedPaints: 502,
    credits: 380,
  }),
});

assert.equal(client.player.credits, 380);
assert(client.player.unlockedPaints.includes(colors.cyan));
const unlockedPaints = client.player.unlockedPaints;

// A repeated authoritative mask must undo optimistic paint rewards too.
client.player.unlockedPaints.push(colors.red);

socket.onmessage?.({
  data: encodeServerControl({ type: 'progress', unlockedPaints: 502 }),
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
  { name?: string; position: { x: number; y: number } }
>;

assert.equal(authoritative.get(2)?.name, 'before');

assert.deepEqual(decodeClientMessage(socket.sent.at(-1)!), {
  type: 'snapshotAck',
  sequence: 1,
});

const beforeActivity = socket.sent.length;

client.sendActivity({ now: 0 });

assert.deepEqual(decodeClientMessage(socket.sent.at(-1)!), {
  type: 'activity',
});

for (const now of [1, 100, 10_000, 29_999]) client.sendActivity({ now });

assert.equal(
  socket.sent.length,
  beforeActivity + 1,
  'activity bursts are throttled',
);
client.sendActivity({ now: 30_000 });
assert.equal(socket.sent.length, beforeActivity + 2);

assert.deepEqual(decodeClientMessage(socket.sent.at(-1)!), {
  type: 'activity',
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
assert.equal(authoritative.get(2)?.name, '');
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
    fullEntities: [{ id: 2, name: 'JSON is invalid' }],
  }),
});

assert.deepEqual(socket.closed, [1007], 'JSON snapshots are rejected');
assert.equal(authoritative.get(2)?.name, '');

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

// A resumed tab can reach its prediction limit before a newer snapshot arrives.
// That snapshot can be close to the predicted clock but beyond the old limit.
for (const gap of [1, maxPredictionTicks, maxPredictionTicks + 1]) {
  const recoveringClient = new NetworkClient({ url: 'ws://catch-up-test' });
  const receive = Reflect.get(recoveringClient, 'receive').bind(
    recoveringClient,
  );

  receive({
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

  receive({
    message: {
      type: 'load',
      serverTick: 0,
      nextEntityId: 1,
      entityIds: [],
      fullEntities: [],
    },
  });

  for (let tick = 0; tick < maxPredictionTicks + 1; tick++) {
    recoveringClient.update({ input: emptyPlayerInput() });
  }

  assert.equal(recoveringClient.world.tick, maxPredictionTicks);
  const serverTick = maxPredictionTicks + gap;

  receive({
    message: {
      type: 'snapshot',
      serverTick,
      nextEntityId: 1,
      entityIds: [],
      fullEntities: [],
    },
  });

  recoveringClient.updateFrame({
    input: emptyPlayerInput(),
    now: performance.now() + 1,
    dt: 0,
  });

  assert.equal(recoveringClient.serverTick, serverTick);
  assert.equal(recoveringClient.world.tick, serverTick);

  recoveringClient.updateFrame({
    input: emptyPlayerInput(),
    now: performance.now() + 2,
    dt: simulationStep,
  });

  assert.equal(
    recoveringClient.world.tick,
    serverTick + 1,
    'prediction resumes after adopting a snapshot beyond the old limit',
  );
}

// The browser may execute a frame after receiving a packet while retaining an
// older rAF timestamp. Reconcile a reached tick without waiting another frame;
// snapshots ahead of that clock must still wait for their receipt boundary.
for (const ahead of [0, 1]) {
  const client = new NetworkClient({ url: 'ws://frame-receipt-test' });
  const receive = Reflect.get(client, 'receive').bind(client);
  const now = performance.now() + 100;

  receive({
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

  receive({
    message: {
      type: 'load',
      serverTick: 0,
      nextEntityId: 1,
      entityIds: [],
      fullEntities: [],
    },
  });

  for (let tick = 0; tick <= ahead; tick++) {
    client.updateFrame({ input: emptyPlayerInput(), now, dt: simulationStep });
  }

  const snapshot = (serverTick: number) => {
    receive({
      message: {
        type: 'snapshot',
        serverTick,
        nextEntityId: 1,
        entityIds: [],
        fullEntities: [],
      },
    });

    Reflect.set(client, 'snapshotReceivedAt', now + 5);
  };

  snapshot(1);
  client.updateFrame({ input: emptyPlayerInput(), now, dt: 0 });
  assert.equal(
    client.serverTick,
    1,
    'a reached snapshot tick reconciles immediately',
  );
  assert.equal(
    client.world.tick,
    1 + ahead,
    'receipt does not advance prediction',
  );

  const future = client.world.tick + 1;

  snapshot(future);
  client.updateFrame({ input: emptyPlayerInput(), now, dt: 0 });
  assert.equal(
    client.serverTick,
    1,
    'a future snapshot stays pending before receipt time',
  );
  client.updateFrame({ input: emptyPlayerInput(), now: now + 6, dt: 0 });
  assert.equal(
    client.serverTick,
    future,
    'the future snapshot reconciles once due',
  );
  assert.equal(client.world.tick, future);
}

const malformedClient = new NetworkClient({ url: 'ws://malformed-test' });
const malformedSocket = Socket.sockets.at(-1)!;

void malformedClient;
malformedSocket.onmessage?.({ data: Uint8Array.of(0) });
assert.deepEqual(malformedSocket.closed, [1007]);

console.log(
  'Binary snapshots decode, reconcile, acknowledge, and reject malformed packets',
);

const transit = new Writer();

start(transit, 0, 0, 2);
transit.unsigned(1);
transit.record(1, [
  [41, () => transit.number(-1.25)],
  [42, () => transit.number(987)],
]);
const transitMessage = decodeBinarySnapshot(transit.packet());

assert.equal(transitMessage.fullEntities[0].transitTime, -1.25);
assert.equal(transitMessage.fullEntities[0].transitGate, 987);

for (const hostile of [0, 1, 2]) {
  const writer = new Writer();

  start(writer, 0, 0, 1);
  writer.unsigned(1);
  writer.record(1, [[46, () => writer.byte(hostile)]]);

  if (hostile > 1) {
    assert.throws(() => decodeBinarySnapshot(writer.packet()));
  } else {
    assert.equal(
      decodeBinarySnapshot(writer.packet()).fullEntities[0].hostile,
      !!hostile,
    );
  }
}

for (const state of [null, 'Fighting', 'Collecting']) {
  const writer = new Writer();

  start(writer, 0, 0, 1);
  writer.unsigned(1);
  writer.record(1, [[47, state === null ? null : () => writer.string(state)]]);
  assert.equal(
    decodeBinarySnapshot(writer.packet()).fullEntities[0].npcState,
    state,
  );
}

// Build module packets independently of the server encoder.
const modulePacket = (write: (writer: Writer) => void, load = false) => {
  const writer = new Writer();

  start(writer, load ? 1 : 0, 0, 2);
  writer.unsigned(1);
  writer.record(1, [[17, () => write(writer)]]);
  return writer.packet();
};

const signedModuleInteger = (writer: Writer, value: number) => {
  writer.unsigned(value < 0 ? -value * 2 - 1 : value * 2);
};

const moduleEntry = (
  writer: Writer,
  id: number,
  palette?: number,
  progress = 0.5,
) => {
  writer.byte(1 | (palette === undefined ? 128 : 4));
  writer.unsigned(8);
  writer.unsigned(0);
  signedModuleInteger(writer, id);

  if (palette !== undefined) writer.byte(palette);
  writer.unsigned(1);
  writer.byte(9);
  writer.number(progress);
};

const full = modulePacket((writer) => {
  writer.unsigned(6); // Three full modules.
  moduleEntry(writer, -1, 0);
  moduleEntry(writer, -2, 1);
  moduleEntry(writer, -3, 2);
}, true);

const previous = decodeBinarySnapshot(full).fullEntities[0];

assert.deepEqual(
  previous.modules?.map((m) => m.shades),
  [colors.red, colors.orange, colors.yellow],
);

const moduleDelta = modulePacket((writer) => {
  writer.unsigned(7); // Three modules with sparse changes.
  writer.byte(2); // Only the second module changed.
  moduleEntry(writer, -2);
});

const changed = decodeBinarySnapshot(moduleDelta).fullEntities[0];

assert.throws(() => mergeModuleStates(changed), /Missing module baseline/);
mergeModuleStates(changed, previous);
assert.deepEqual(changed.modules, previous.modules);

const wrong = decodeBinarySnapshot(moduleDelta).fullEntities[0];

assert.throws(
  () => mergeModuleStates(wrong, { modules: [previous.modules![0]] }),
  /Missing module baseline/,
);

const reordered = {
  modules: [previous.modules![0], previous.modules![2], previous.modules![1]],
};

assert.throws(
  () =>
    mergeModuleStates(
      decodeBinarySnapshot(moduleDelta).fullEntities[0],
      reordered,
    ),
  /Missing module shade baseline/,
);

// The paint update can be followed by sparse animation updates before a render.
const repaintPacket = modulePacket((writer) => {
  writer.unsigned(6);
  moduleEntry(writer, -1, 3);
  moduleEntry(writer, -2, 4);
  moduleEntry(writer, -3, 5);
});

const repainted = decodeBinarySnapshot(repaintPacket).fullEntities[0];

mergeModuleStates(repainted, previous);

const animatedPacket = modulePacket((writer) => {
  writer.unsigned(7);
  writer.byte(2);
  moduleEntry(writer, -2, undefined, 0.75);
});

const animated = decodeBinarySnapshot(animatedPacket).fullEntities[0];

mergeModuleStates(animated, repainted);
const animatedAgain = decodeBinarySnapshot(moduleDelta).fullEntities[0];

mergeModuleStates(animatedAgain, animated);
assert.deepEqual(
  animatedAgain.modules?.map((module) => module.shades),
  [colors.green, colors.cyan, colors.indigo],
);
assert.equal(animated.modules?.[1].segments[0].activationProgress, 0.75);

// A full reordered layout is independent of the prior array.
const layout = modulePacket((writer) => {
  writer.unsigned(4);
  moduleEntry(writer, -3, 5);
  moduleEntry(writer, -1, 3);
});

const refitted = decodeBinarySnapshot(layout).fullEntities[0];

mergeModuleStates(refitted, animatedAgain);
assert.deepEqual(
  refitted.modules?.map((module) => module.id),
  [-3, -1],
);

for (const value of [0, -1, 63, -64, 64, -65, 2 ** 52 - 1, -(2 ** 52 - 1)]) {
  const packet = modulePacket((writer) => {
    writer.unsigned(2);
    writer.byte(1);
    [value, -value, value].forEach((number) =>
      signedModuleInteger(writer, number),
    );
    writer.unsigned(0);
  });

  const module = decodeBinarySnapshot(packet).fullEntities[0].modules![0];

  assert.equal(module.type, value || 0);
  assert.equal(module.mount, -value || 0);
  assert.equal(module.id, value || 0);
}

for (const [index, palette] of Object.values(colors).entries()) {
  const packet = modulePacket((writer) => {
    writer.unsigned(2);
    moduleEntry(writer, -1, index);
  });

  assert.deepEqual(
    decodeBinarySnapshot(packet).fullEntities[0].modules![0].shades,
    palette,
  );
}

for (const bytes of [
  [2, 4, 0, 0, 255, 0], // Unknown palette.
  [2, 128, 0, 0, 0], // Inheritance without an ID or partial array.
  [3, 2], // Bits beyond the array size.
  [2, 1, 128, 0, 0, 0], // Overlong integer.
  [2, 1, 0, 0, 0, 1, 3], // Invalid segment flags.
]) {
  assert.throws(() =>
    decodeBinarySnapshot(
      modulePacket((writer) => bytes.forEach((value) => writer.byte(value))),
    ),
  );
}

assert.throws(() =>
  decodeBinarySnapshot(
    modulePacket((writer) => {
      writer.unsigned(3);
      writer.byte(0);
    }, true),
  ),
);

for (let length = 0; length < full.length; length++) {
  assert.throws(() => decodeBinarySnapshot(full.subarray(0, length)));
}

for (const [code, value] of [
  [0, 0],
  [1, 1],
  [2, -1],
  [3, 0.375],
] as const) {
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      31,
      () => {
        writer.byte(code);

        if (code === 3) writer.number(value);
      },
    ],
    [
      32,
      () => {
        writer.byte(code);

        if (code === 3) writer.number(value);
      },
    ],
  ]);

  const entity = decodeBinarySnapshot(writer.packet()).fullEntities[0];

  assert.equal(entity.thrust, value);
  assert.equal(entity.turn, value);
}
