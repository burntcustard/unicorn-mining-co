import assert from 'node:assert/strict';
import {
  decodeClientMessage,
  decodeServerControl,
  encodeClientMessage,
  encodeServerControl,
} from '../../src/client/protocol/binary-control';
import {
  emptyPlayerInput,
  packPlayerInput,
  sameInput,
  unpackPlayerInput,
} from '../../src/client/protocol/input';
import type { ClientMessage } from '../../src/client/protocol/network';

const playerId = '12345678-9abc-4def-8012-3456789abcde';

for (const displayName of ['', 'a'.repeat(17), '🦄'.repeat(17)]) {
  assert.throws(() => encodeClientMessage({ type: 'profile', displayName }));
}

for (const bytes of [
  [0],
  [2, 255, 255],
  [64, 97],
  [17, ...Array(17).fill(97)],
]) {
  assert.throws(() =>
    decodeClientMessage(Uint8Array.from([0x55, 0x43, 1, 10, ...bytes])),
  );
}

const controls: ClientMessage[] = [
  { type: 'sectorMap', position: { x: -12500.25, y: 62000.5 } },
  { type: 'gateAccess', gateId: 2 ** 45 },
  { type: 'chat', channel: 0, text: '\ufeffHello 🦄 <script> sector' },
  { type: 'chat', channel: 1, text: '🦄'.repeat(240) },
  {
    type: 'input',
    tick: 1,
    sequence: 1,
    input: {
      ...emptyPlayerInput(),
      laserActive: true,
      fire: true,
      cargoRelease: true,
    },
  },
  { type: 'hello', playerId: null },
  { type: 'hello', playerId },
  { type: 'prepare', playerId: null },
  { type: 'prepare', playerId },
  { type: 'play' },
  { type: 'profile', displayName: 'aé🦄 <&>\u0000' },
  { type: 'profile', displayName: '🦄'.repeat(16) },
  { type: 'profile', displayName: '\ufeffA' },
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
  { type: 'dock', action: 'buy', module: 2, moduleId: -2, mount: 0 },
  {
    type: 'dock',
    action: 'buy',
    module: 2,
    moduleId: -3,
    mount: 5,
    sequence: 42,
  },
  {
    type: 'input',
    tick: 5,
    sequence: 6,
    input: {
      ...emptyPlayerInput(),
      fire: true,
      plasmaActive: true,
      autogunActive: true,
    },
    offset: 0.01,
  },
  {
    type: 'input',
    tick: 6,
    sequence: 7,
    input: { ...emptyPlayerInput(), plasmaActive: true },
  },
  {
    type: 'input',
    tick: 7,
    sequence: 8,
    input: { ...emptyPlayerInput(), autogunActive: true },
  },
  {
    type: 'input',
    tick: 8,
    sequence: 9,
    input: { ...emptyPlayerInput(), fire: true },
  },
  {
    type: 'input',
    tick: 9,
    sequence: 10,
    input: { ...emptyPlayerInput(), flightMode: true },
  },
  {
    type: 'input',
    tick: 10,
    sequence: 11,
    input: { ...emptyPlayerInput(), thrustBoost: true },
  },
  { type: 'dock', action: 'buyAmmo' },
  { type: 'dock', action: 'buyAmmo', sequence: 42 },
  { type: 'dock', action: 'buyStock', objectIds: [42], sequence: 43 },
  { type: 'dock', action: 'sell', objectIds: [-1, 2] },
  { type: 'dock', action: 'buyStock', objectIds: [42] },
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
  { type: 'dock', action: 'repairHull', hullIndex: 4 },
  { type: 'respawn' },
  { type: 'activity' },
  { type: 'snapshotAck', sequence: Number.MAX_SAFE_INTEGER },
];

for (const message of controls) {
  const encoded = encodeClientMessage(message);
  const padded = Uint8Array.from([0, ...encoded, 0]);

  assert.deepEqual(decodeClientMessage(encoded), message);
  assert.deepEqual(decodeClientMessage(padded.subarray(1, -1)), message);
  assert.deepEqual(decodeClientMessage(encoded.buffer), message);
}

for (const targetId of [
  0,
  -1,
  2 ** 45,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
]) {
  for (const offset of [undefined, 0, 0.015]) {
    const message: ClientMessage = {
      type: 'input',
      tick: 9,
      sequence: 10,
      input: {
        ...emptyPlayerInput(),
        targetId,
        fire: true,
        autogunActive: true,
        flightMode: true,
        thrustBoost: true,
      },
      ...(offset !== undefined && { offset }),
    };

    assert.deepEqual(
      decodeClientMessage(encodeClientMessage(message)),
      message,
    );
    assert(!sameInput(message.input, emptyPlayerInput()));
    assert(sameInput(message.input, { ...message.input }));
    assert(
      !sameInput(message.input, { ...message.input, targetId: undefined }),
    );
    assert(!sameInput(message.input, { ...message.input, flightMode: false }));
    assert(!sameInput(message.input, { ...message.input, thrustBoost: false }));
  }
}

const flightInput = { ...emptyPlayerInput(), flightMode: true };

assert.equal(packPlayerInput(flightInput), 1 << 13);
assert.deepEqual(unpackPlayerInput(packPlayerInput(flightInput)), flightInput);
assert(
  sameInput(emptyPlayerInput(), { ...emptyPlayerInput(), flightMode: false }),
);
assert(!sameInput(flightInput, emptyPlayerInput()));
assert(!sameInput(emptyPlayerInput(), flightInput));

const boostInput = { ...emptyPlayerInput(), thrustBoost: true };

assert.equal(packPlayerInput(boostInput), 1 << 14);
assert.deepEqual(unpackPlayerInput(packPlayerInput(boostInput)), boostInput);
assert(
  sameInput(emptyPlayerInput(), { ...emptyPlayerInput(), thrustBoost: false }),
);
assert(!sameInput(boostInput, emptyPlayerInput()));
assert(!sameInput(emptyPlayerInput(), boostInput));

for (const turn of [-1, 0, 1]) {
  const message: ClientMessage = {
    type: 'input',
    tick: 1,
    sequence: 1,
    offset: 0.015,
    input: {
      hornDrill: true,
      cargoHatch: true,
      searchLight: true,
      shieldGenerator: true,
      launch: true,
      thrust: 1,
      turn,
      fire: true,
      plasmaActive: true,
      autogunActive: true,
      laserActive: true,
      cargoRelease: true,
      flightMode: true,
      thrustBoost: true,
      targetId: -130,
    },
  };

  const encoded = encodeClientMessage(message);

  const withoutFlightMode = encodeClientMessage({
    ...message,
    input: { ...message.input, flightMode: undefined },
  });

  assert.equal(
    encoded[7],
    255,
    'flight mode composes with every optional input flag',
  );
  assert.equal(
    withoutFlightMode[7],
    127,
    'all existing optional flag bits stay in place',
  );
  assert.deepEqual(encoded.slice(0, 7), withoutFlightMode.slice(0, 7));
  assert.deepEqual(
    encoded.slice(8),
    withoutFlightMode.slice(8),
    'offset and target payloads do not move',
  );
  assert.deepEqual(decodeClientMessage(encoded), message);
  assert.equal(encoded[8], 1, 'thrust boost composes with every other control');

  assert(
    sameInput(unpackPlayerInput(packPlayerInput(message.input)), {
      ...message.input,
      targetId: undefined,
    }),
  );
}

for (const targetId of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(
    () =>
      encodeClientMessage({
        type: 'input',
        tick: 1,
        sequence: 1,
        input: { ...emptyPlayerInput(), targetId },
      }),
    /Invalid binary control integer/,
  );
}

for (const message of [
  {
    type: 'chat' as const,
    channel: 1,
    senderRole: 'user',
    sender: 'Jump Gate',
    text: '\ufeffAccess granted.',
  },
  ...[0, 281474976710999].map((cargoDemand) => ({
    type: 'chat' as const,
    channel: 0,
    sender: 'Pirate',
    senderRole: 'hostile',
    text: '',
    cargoDemand,
  })),
  { type: 'profile' as const, displayName: 'aé🦄 <&>\u0000' },
  {
    type: 'welcome' as const,
    playerNumber: 2,
    playerId,
    shipId: 7,
    serverTick: 80,
    worldSeed: 25,
    spawn: { x: 0, y: 0 },
    unlockedPaints: 96,
    credits: 500,
    displayName: '🦄'.repeat(16),
    sectorName: 'Hippokoon',
  },
  {
    type: 'welcome' as const,
    playerNumber: 2,
    playerId,
    shipId: 7,
    serverTick: Number.MAX_SAFE_INTEGER,
    worldSeed: 8675309,
    spawn: { x: -1.25, y: 2.5 },
  },
  { type: 'respawn' as const, shipId: 8 },
  { type: 'progress' as const, unlockedPaints: 127 },
  { type: 'progress' as const, unlockedPaints: 511 },
  { type: 'progress' as const, unlockedPaints: 0xffff },
  { type: 'progress' as const, unlockedPaints: 486, credits: 2000 },
  { type: 'progress' as const, unlockedPaints: 100, credits: 0 },
  {
    type: 'welcome' as const,
    playerNumber: 2,
    playerId,
    shipId: 7,
    serverTick: 500,
    worldSeed: 25,
    spawn: { x: 1, y: 2 },
    unlockedPaints: 486,
    credits: 12345,
  },
]) {
  const encoded = encodeServerControl(message);

  assert.deepEqual(decodeServerControl(encoded), message);
  assert.deepEqual(decodeServerControl(encoded.buffer), message);

  if (message.type !== 'profile') {
    assert.throws(() => decodeClientMessage(encoded), /Invalid binary control/);
  }
}

const mapMessage = {
  type: 'sectorMap' as const,
  mapMarkers: (
    ['field', 'station', 'ship', 'jumpGate', 'wormhole'] as const
  ).map((kind, id) => ({
    kind,
    id,
    position: { x: -12000.25, y: 62000.5 },
    radius: kind === 'field' ? 3500 : 0,
    name: 'Pilot 🦄',
    definitionId: kind === 'station' ? 'corral-6' : '',
    color: '#4df',
    ...(kind === 'ship' ? { senderRole: 'admin' } : {}),
  })),
};

const mapPacket = encodeServerControl(mapMessage);

assert.deepEqual(decodeServerControl(mapPacket), mapMessage);
assert.deepEqual(
  decodeServerControl(
    encodeServerControl({ type: 'sectorMap', mapMarkers: [] }),
  ),
  { type: 'sectorMap', mapMarkers: [] },
);

for (const packet of [
  mapPacket.slice(0, -1),
  Uint8Array.from([...mapPacket, 0]),
  changedMapKind(),
]) {
  assert.throws(() => decodeServerControl(packet));
}

function changedMapKind() {
  const packet = mapPacket.slice();

  packet[5] = 255;
  return packet;
}

const hello = encodeClientMessage({ type: 'hello', playerId: null });
const activity = encodeClientMessage({ type: 'activity' });

assert.deepEqual([...activity], [0x55, 0x43, 1, 7]);
assert.throws(
  () => decodeClientMessage(Uint8Array.from([...activity, 0])),
  /Invalid binary control/,
);

const input = encodeClientMessage({
  type: 'input',
  tick: 1,
  sequence: 1,
  input: emptyPlayerInput(),
});

assert.deepEqual(
  [...input],
  [0x55, 0x43, 1, 1, 1, 1, 0, 0, 0],
  'input controls include an extension byte for thrust boost',
);

const flightPacket = encodeClientMessage({
  type: 'input',
  tick: 1,
  sequence: 1,
  input: flightInput,
});

assert.deepEqual(
  [...flightPacket],
  [0x55, 0x43, 1, 1, 1, 1, 0, 128, 0],
  'flight mode keeps its existing high flag bit',
);

assert.deepEqual(decodeClientMessage(flightPacket), {
  type: 'input',
  tick: 1,
  sequence: 1,
  input: flightInput,
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
  changed(hello, 4, 4), // unknown hello capability
  Uint8Array.from([...hello, 0]), // trailing byte
  Uint8Array.from([0x55, 0x43, 1, 4, 0x80, 0]), // noncanonical varint
  changed(input, 6, 192), // invalid input control bits
  changed(input, 8, 2), // unknown extension control bit
  changed(input, 8, 255), // unknown extension control bits
  input.slice(0, -1), // missing extension control byte
  changed(input, 7, 64), // missing target ID
  Uint8Array.from([...changed(input, 7, 64), 0x80, 0]), // noncanonical target ID
  Uint8Array.from([
    ...changed(input, 7, 64),
    0x80,
    0x80,
    0x80,
    0x80,
    0x80,
    0x80,
    0x80,
    0x20,
  ]), // unsafe target ID
  changed(paint, 6, 4), // unknown optional field bit
  Uint8Array.from([0x55, 0x43, 1, 2, 1, 0]), // empty sell list
]) {
  assert.throws(() => decodeClientMessage(invalid), /Invalid binary control/);
}

assert.throws(
  () => encodeClientMessage({ type: 'hello', playerId: 'bad' }),
  /Invalid binary control player ID/,
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
assert.throws(
  () => decodeClientMessage(Uint8Array.from([0x55, 0x43, 1, 0, 4])),
  /Invalid binary control/,
);
assert.throws(
  () =>
    decodeServerControl(
      encodeServerControl({ type: 'progress', unlockedPaints: 0x10000 }),
    ),
  /Invalid binary control/,
);

assert.throws(() =>
  encodeClientMessage({ type: 'chat', channel: 2, text: 'Bad channel' }),
);
assert.throws(() =>
  encodeClientMessage({ type: 'chat', channel: 0, text: 'a'.repeat(241) }),
);
