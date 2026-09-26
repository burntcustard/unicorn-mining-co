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
      export { createAsteroid } from '${resolve('src/shared/simulation/asteroid.ts')}';
      export { createStation } from '${resolve('src/shared/craft/create-station.ts')}';
      export * as Vec from '${resolve('src/shared/vector.ts')}';
      export { captureWorld, restoreWorld } from '${resolve('src/shared/simulation/world-state.ts')}';
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
  createAsteroid,
  createStation,
  captureWorld,
  restoreWorld,
  Vec,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const world = createWorld();
const ship = addEntity(world, createShip(world, { playerId: 1 }));
const station = addEntity(
  world,
  createStation({ world, position: Vec.create(700) }),
);
const replication = new ReplicationManager();
const distantStation = addEntity(
  world,
  createStation({ world, position: Vec.create(8000) }),
);
const initial = replication.initial({
  world,
  shipId: ship.id,
});

assert.equal(initial.entityIds, undefined, 'load IDs come from full records');
const saved = captureWorld({ world });

station.friction = 0;
restoreWorld({ world, state: saved });
assert.equal(station.friction, 0.2, 'rollback restores the material value');
const stationRecord = initial.fullEntities.find(
  (entity) => entity.id === station.id,
);

assert.equal(stationRecord.friction, undefined);
assert.equal(stationRecord.hullHealth, undefined);
assert.equal(stationRecord.shades, undefined);
assert.equal(stationRecord.velocity, undefined);
assert.equal(stationRecord.pendingUpdateTime, undefined);

assert(
  initial.fullEntities.some((entity) => entity.id === distantStation.id),
  'stations are fully loaded at 8 km',
);
const counts = new Map([...world.entities.keys()].map((id) => [id, 0]));

for (let tick = 1; tick <= 60; tick++) {
  world.tick = tick;
  ship.rotation = station.rotation = distantStation.rotation = tick;
  const packet = replication.snapshot({
    world,
    shipId: ship.id,
  });

  packet.fullEntities.forEach((entity) =>
    counts.set(entity.id, counts.get(entity.id) + 1),
  );
  assert.equal(
    packet.entityIds,
    undefined,
    'unchanged interest has no id list',
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
Vec.set(distantStation.position, Vec.create(12000));
const departed = replication.snapshot({
  world,
  shipId: ship.id,
});

assert(
  !departed.entityIds.includes(distantStation.id),
  'unloads do not wait for a distant snapshot',
);
Vec.set(distantStation.position, Vec.create(8000));
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
assert.deepEqual(
  network.authoritativeEntities.get(station.id).hullHealth,
  station.hullHealth,
);
assert.deepEqual(
  network.authoritativeEntities.get(station.id).shades,
  station.shades,
);
station.friction = 0;
const slippery = replication.snapshot({ world, shipId: ship.id });

assert.equal(
  slippery.fullEntities.find((entity) => entity.id === station.id).friction,
  0,
  'an explicit zero is sent to clients',
);
deliver(slippery);
assert.equal(network.authoritativeEntities.get(station.id).friction, 0);
assert.equal(network.world.entities.get(station.id).friction, 0);
station.friction = 0.2;
const normal = replication.snapshot({ world, shipId: ship.id });

assert.equal(
  normal.fullEntities.find((entity) => entity.id === station.id).friction,
  null,
  'clearing an optional field sends a null marker',
);
deliver(normal);
assert.equal(network.authoritativeEntities.get(station.id).friction, 0.2);
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
const state = damaged.fullEntities.find((entity) => entity.id === ship.id);

state.hullHealth = state.hullHealth.map((health) =>
  health > 0 ? health / 2 : health,
);
deliver(damaged);
assert.deepEqual(
  network.world.entities.get(ship.id).hullHealth,
  state.hullHealth,
);
deliver(snapshot);
assert.deepEqual(
  network.world.entities.get(ship.id).hullHealth,
  ship.hullHealth,
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

// A compact asteroid update is expanded before motion tracking and prediction.
const asteroidWorld = createWorld();
const asteroidObserver = addEntity(
  asteroidWorld,
  createShip(asteroidWorld, { playerId: 1 }),
);
const asteroid = addEntity(
  asteroidWorld,
  createAsteroid(asteroidWorld, {
    contents: [1],
    position: Vec.create(300),
    radius: 100,
  }),
);
const asteroidReplication = new ReplicationManager();
const asteroidLoad = asteroidReplication.initial({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});
const pristine = asteroidLoad.fullEntities.find(
  (entity) => entity.id === asteroid.id,
);

assert.equal(pristine.segments, undefined);
const asteroidClient = new NetworkClient({ url: 'ws://asteroid-test' });
const asteroidSocket = socket;
const deliverAsteroid = (message) =>
  asteroidSocket.onmessage({ data: JSON.stringify(message) });

deliverAsteroid({
  type: 'welcome',
  playerToken: 'asteroid-test',
  playerId: 1,
  shipId: asteroidObserver.id,
  serverTick: 0,
  worldSeed: 1,
  spawn: { x: 0, y: 0 },
});
deliverAsteroid(asteroidLoad);
assert.deepEqual(
  asteroidClient.authoritativeEntities.get(asteroid.id).segments,
  asteroid.segments,
  'client rebuilds untouched asteroid segments from the same seed',
);
asteroid.segments[0].health -= 1;
asteroid.rotation = 0.5;
asteroidWorld.tick = 1;
const asteroidUpdate = asteroidReplication.snapshot({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});
const damagedAsteroid = asteroidUpdate.fullEntities.find(
  (entity) => entity.id === asteroid.id,
);

assert(damagedAsteroid.segments, 'changed segments are sent once');
assert.equal(damagedAsteroid.contents, undefined);
deliverAsteroid(asteroidUpdate);
asteroidClient.update({ input: emptyPlayerInput() });
assert.equal(
  asteroidClient.authoritativeEntities.get(asteroid.id).segments[0].health,
  asteroid.segments[0].health,
);
asteroid.rotation = 1;
asteroidWorld.tick = 2;
const motionUpdate = asteroidReplication.snapshot({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});
const movingAsteroid = motionUpdate.fullEntities.find(
  (entity) => entity.id === asteroid.id,
);

assert.equal(movingAsteroid.segments, undefined);
assert.equal(movingAsteroid.contents, undefined);
assert.equal(movingAsteroid.rotation, 1);
deliverAsteroid(motionUpdate);
asteroidClient.update({ input: emptyPlayerInput() });
assert.equal(
  asteroidClient.authoritativeEntities.get(asteroid.id).segments[0].health,
  asteroid.segments[0].health,
  'a later motion update retains the last segment state',
);
asteroid.decay = 2;
asteroidWorld.tick = 3;
deliverAsteroid(
  asteroidReplication.snapshot({
    world: asteroidWorld,
    shipId: asteroidObserver.id,
  }),
);
asteroidClient.update({ input: emptyPlayerInput() });
assert.equal(asteroidClient.authoritativeEntities.get(asteroid.id).decay, 2);
asteroid.decay = undefined;
asteroidWorld.tick = 4;
const cleared = asteroidReplication.snapshot({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});

assert.equal(
  cleared.fullEntities.find((entity) => entity.id === asteroid.id).decay,
  null,
  'cleared optional fields use a null wire marker',
);
deliverAsteroid(cleared);
asteroidClient.update({ input: emptyPlayerInput() });
assert.equal(
  asteroidClient.authoritativeEntities.get(asteroid.id).decay,
  undefined,
);
Vec.setXY(asteroid.position, 5000, 0);
asteroidWorld.tick = 5;
deliverAsteroid(
  asteroidReplication.snapshot({
    world: asteroidWorld,
    shipId: asteroidObserver.id,
  }),
);
asteroidClient.update({ input: emptyPlayerInput() });
Vec.setXY(asteroid.position, 300, 0);
asteroidWorld.tick = 6;
const reentered = asteroidReplication.snapshot({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});

assert.equal(
  reentered.fullEntities.find((entity) => entity.id === asteroid.id).kind,
  'asteroid',
  'an asteroid reentering view gets a full record',
);
deliverAsteroid(reentered);
asteroidClient.update({ input: emptyPlayerInput() });
assert.equal(
  asteroidClient.authoritativeEntities.get(asteroid.id).segments[0].health,
  asteroid.segments[0].health,
);
asteroidWorld.tick = 7;
const unchanged = asteroidReplication.snapshot({
  world: asteroidWorld,
  shipId: asteroidObserver.id,
});

assert(
  !unchanged.fullEntities.some((entity) => entity.id === asteroid.id),
  'unchanged asteroids need no record at all',
);

// No delayed packets: even immediate snapshots used to keep throwing away
// the history needed to reconcile a client that starts ahead of the server.
const turningWorld = createWorld();
const observer = addEntity(
  turningWorld,
  createShip(turningWorld, { playerId: 1 }),
);
const turningShip = addEntity(
  turningWorld,
  createShip(turningWorld, { playerId: 2, position: Vec.create(500) }),
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
