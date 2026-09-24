import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { rolldown } from 'rolldown';

let socket;

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: () => null, setItem() {} },
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      socket = this;
    }
    send() {}
  },
});
const bundle = await rolldown({
  input: 'snapshots-test',
  plugins: [
    {
      name: 'snapshots-test',
      resolveId: (id) =>
        id === 'snapshots-test' ? '\0snapshots-test' : undefined,
      load: (id) =>
        id === '\0snapshots-test'
          ? `
      export { network, NetworkClient } from '${resolve('src/client/network.ts')}';
      export { updateWorld } from '${resolve('src/shared/simulation/update-world.ts')}';
      export { emptyPlayerInput } from '${resolve('src/shared/protocol/input.ts')}';
      export { ReplicationManager } from '${resolve('src/server/replication.ts')}';
      export { createWorld, addEntity, addPlayer } from '${resolve('src/shared/simulation/world.ts')}';
      export { createShip } from '${resolve('src/shared/craft/create-ship.ts')}';
      export { createStation } from '${resolve('src/shared/craft/create-station.ts')}';
      export { Vector } from '${resolve('src/shared/vector.ts')}';
    `
          : undefined,
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const {
  network,
  NetworkClient,
  updateWorld,
  emptyPlayerInput,
  addPlayer,
  ReplicationManager,
  createWorld,
  addEntity,
  createShip,
  createStation,
  Vector,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const world = createWorld();
const ship = addEntity(world, createShip(world, { playerId: 1 }));
const station = addEntity(
  world,
  createStation({ world, position: Vector(700) }),
);
const replication = new ReplicationManager();
const distantStation = addEntity(
  world,
  createStation({ world, position: Vector(8000) }),
);
const initial = replication.initial({
  world,
  shipId: ship.id,
});

assert(
  initial.fullEntities.some((entity) => entity.id === distantStation.id),
  'stations are fully loaded at 8 km',
);
const counts = new Map([...world.entities.keys()].map((id) => [id, 0]));

for (let tick = 1; tick <= 60; tick++) {
  world.tick = tick;
  const packet = replication.snapshot({
    world,
    shipId: ship.id,
  });

  packet.fullEntities.forEach((entity) =>
    counts.set(entity.id, counts.get(entity.id) + 1),
  );

  if (tick % 4 === 0) {
    assert.equal(
      packet.fullEntities.length,
      3,
      'all due tiers share one packet',
    );
  }
}
assert.equal(counts.get(ship.id), 60, 'close replication is 30 Hz');
assert.equal(counts.get(station.id), 60, 'visible replication is 30 Hz');
assert.equal(
  counts.get(distantStation.id),
  15,
  'distant replication is 7.5 Hz',
);
world.tick = 0;
world.tick = 121;
distantStation.position.set(Vector(12000));
const departed = replication.snapshot({
  world,
  shipId: ship.id,
});

assert(
  !departed.entityIds.includes(distantStation.id),
  'unloads do not wait for a distant snapshot',
);
distantStation.position.set(Vector(8000));
world.tick = 122;
const returned = replication.snapshot({
  world,
  shipId: ship.id,
});

assert(
  returned.fullEntities.some((entity) => entity.id === distantStation.id),
  'new interest loads immediately between distant update ticks',
);
world.entities.delete(distantStation.id);
world.tick = 123;
const destroyed = replication.snapshot({
  world,
  shipId: ship.id,
});

assert(
  !destroyed.entityIds.includes(distantStation.id),
  'destruction removes authoritative membership immediately',
);
addEntity(world, distantStation);
world.tick = 0;
socket.onmessage({
  data: JSON.stringify({
    type: 'welcome',
    playerToken: 'snapshots',
    playerId: 1,
    shipId: ship.id,
    serverTick: 0,
    worldSeed: 1,
    spawn: { x: 0, y: 0 },
  }),
});
let packetTick = 0;
const deliver = (message) => {
  socket.onmessage({
    data: JSON.stringify({ ...message, serverTick: ++packetTick }),
  });

  if (message.type === 'snapshot') {
    network.update({ input: emptyPlayerInput() });
  }
};

deliver(initial);
const wireShip = initial.fullEntities.find((entity) => entity.id === ship.id);
const decodedShip = network.authoritativeEntities.get(ship.id);

assert.deepEqual(
  decodedShip.modules.map(({ id }) => id),
  wireShip.modules.map(({ id }) => id),
  'mounted module IDs survive snapshot decoding for later sales',
);
const decoded = network.authoritativeEntities.get(station.id);
const live = network.world.entities.get(station.id);

assert.notEqual(
  decoded,
  live,
  'decoded authority is separate from predicted entities',
);
const segments = decoded.segments;
const snapshot = {
  ...initial,
  type: 'snapshot',
  entityIds: initial.fullEntities.map((entity) => entity.id),
};

deliver(snapshot);
assert.equal(
  network.authoritativeEntities.get(station.id),
  decoded,
  'unchanged craft is decoded in place',
);
assert.equal(
  decoded.segments,
  segments,
  'unchanged hull geometry is not rebuilt',
);
live.position.x = 999;
assert.equal(
  decoded.position.x,
  700,
  'prediction does not mutate decoded authority',
);
const damaged = structuredClone(snapshot);
const state = damaged.fullEntities.find((entity) => entity.id === station.id);

state.hullHealth = state.hullHealth.map((health) =>
  health > 0 ? health / 2 : health,
);
deliver(damaged);
assert.deepEqual(
  network.world.entities.get(station.id).hullHealth,
  state.hullHealth,
);
deliver(snapshot);
assert.deepEqual(
  network.world.entities.get(station.id).hullHealth,
  station.hullHealth,
  'repair restores authoritative health',
);
const wires = Array.from({ length: 2100 }, () =>
  JSON.stringify({ ...snapshot, serverTick: ++packetTick }),
);
let packet = 0;
const applyNext = () => {
  socket.onmessage({ data: wires[packet++] });
  network.update({ input: emptyPlayerInput() });
};

for (let i = 0; i < 100; i++) applyNext();

for (const reuse of [false, true]) {
  const start = performance.now();

  for (let i = 0; i < 1000; i++) {
    if (!reuse) network.authoritativeEntities.clear();
    applyNext();
  }
  console.log(
    `Snapshot decode and apply (${reuse ? 'reused' : 'reconstructed'} craft): ${((performance.now() - start) / 1000).toFixed(3)} ms/packet (ship + two stations)`,
  );
}
deliver({ ...snapshot, fullEntities: [] });
assert.equal(
  network.world.entities.size,
  snapshot.entityIds.length,
  'entities not due in a partial snapshot stay loaded',
);
deliver({ ...snapshot, fullEntities: [], entityIds: [] });
assert.equal(
  network.authoritativeEntities.size,
  0,
  'unloaded authority is evicted',
);
assert.equal(
  network.world.entities.size,
  0,
  'unloaded predicted entities are removed',
);
console.log('Snapshot reuse, damage, repair, isolation and eviction passed');

// No delayed packets: even immediate snapshots used to keep throwing away
// the history needed to reconcile a client that starts ahead of the server.
const turningWorld = createWorld();
const observer = addEntity(
  turningWorld,
  createShip(turningWorld, { playerId: 1 }),
);
const turningShip = addEntity(
  turningWorld,
  createShip(turningWorld, { playerId: 2, position: Vector(500) }),
);

addPlayer(turningWorld, { id: 1, shipId: observer.id });
addPlayer(turningWorld, { id: 2, shipId: turningShip.id });
turningShip.fly(0, 1);
turningShip.spin = (turningShip.turnRate * turningShip.rotationalThrust) / 16;
const client = new NetworkClient({ url: 'ws://test' });
const clientSocket = socket;
const sendState = (message) =>
  clientSocket.onmessage({ data: JSON.stringify(message) });
const turningReplication = new ReplicationManager();

sendState({
  type: 'welcome',
  playerToken: 'test',
  playerId: 1,
  shipId: observer.id,
  serverTick: 0,
  worldSeed: 1,
  spawn: { x: 0, y: 0 },
});
sendState(
  turningReplication.initial({ world: turningWorld, shipId: observer.id }),
);
const idle = emptyPlayerInput();
const turn = { ...idle, turn: 1 };

for (let tick = 0; tick < 30; tick++) {
  client.update({ input: idle });
  updateWorld({
    world: turningWorld,
    inputs: new Map([
      [1, idle],
      [2, turn],
    ]),
  });
  sendState(
    turningReplication.snapshot({ world: turningWorld, shipId: observer.id }),
  );
}
assert(
  client.prediction.history.size > 0,
  'startup snapshots must not continually erase prediction history',
);
const remote = client.world.entities.get(turningShip.id);
const expectedRotation =
  turningShip.rotation +
  (turningShip.spin * (client.world.tick - turningWorld.tick)) / 30;

assert(
  Math.abs(remote.rotation - expectedRotation) < 1e-9,
  'turning remote ships must be extrapolated to the client tick, not left at the older snapshot tick',
);
