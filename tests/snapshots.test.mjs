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
      export { encodeServerControl } from '${resolve('src/shared/protocol/binary-control.ts')}';
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
  encodeServerControl,
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
  data: encodeServerControl({
    type: 'welcome',
    playerToken: '00000000-0000-4000-8000-000000000001',
    playerId: 1,
    shipId: ship.id,
    serverTick: 0,
    worldSeed: 1,
    spawn: { x: 0, y: 0 },
  }),
});
let packetTick = 0;
const deliver = (message) => {
  network.receive({ message: { ...message, serverTick: ++packetTick } });

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
const repairMountIndex = ship.mounts.findIndex(({ module }) => module);
const repairMount = ship.mounts[repairMountIndex];
const repairModule = repairMount.module;
const liveShip = network.world.entities.get(ship.id);

repairMount.health -= 1;
deliver(replication.snapshot({ world, shipId: ship.id }));
assert.equal(
  network.authoritativeEntities.get(ship.id).mounts[repairMountIndex].health,
  repairMount.health,
);
assert.equal(
  liveShip.mounts[repairMountIndex].health,
  repairMount.health,
  'module damage reaches the mounted client instance',
);
assert.equal(
  liveShip.mounts[repairMountIndex].module.id,
  repairModule.id,
  'mounted ID survives the damage reconciliation',
);
liveShip.fit(0, liveShip.mounts[repairMountIndex]);
liveShip.moduleStates = decodedShip.moduleStates;
assert.equal(
  liveShip.mounts[repairMountIndex].module.id,
  repairModule.id,
  'rebuilding an equipped module retains its server ID',
);
ship.applyDockAction({
  action: 'repair',
  moduleId: repairModule.id,
  mount: repairMountIndex,
});
deliver(replication.snapshot({ world, shipId: ship.id }));
assert.equal(
  liveShip.mounts[repairMountIndex].health,
  repairModule.health,
  'FIX restores mounted health without removing and equipping',
);
assert.equal(
  liveShip.mounts[repairMountIndex].module.id,
  repairModule.id,
  'FIX keeps the server module ID for later dock actions',
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
const wires = Array.from({ length: 2100 }, () => ({
  ...snapshot,
  serverTick: ++packetTick,
}));
let packet = 0;
const applyNext = () => {
  network.receive({ message: wires[packet++] });
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
  message.type === 'welcome' || message.type === 'respawn'
    ? asteroidSocket.onmessage({ data: encodeServerControl(message) })
    : asteroidClient.receive({ message });

deliverAsteroid({
  type: 'welcome',
  playerToken: '00000000-0000-4000-8000-000000000002',
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
  message.type === 'welcome' || message.type === 'respawn'
    ? clientSocket.onmessage({ data: encodeServerControl(message) })
    : client.receive({ message });
const turningReplication = new ReplicationManager();

sendState({
  type: 'welcome',
  playerToken: '00000000-0000-4000-8000-000000000003',
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

// Extrapolated motion is quantized within half a binary motion-grid step.
assert(
  Math.abs(remote.rotation - expectedRotation) <= 2 ** -25,
  'turning remote ships must be extrapolated to the client tick, not left at the older snapshot tick',
);

// One emission round shares preparation, while each player keeps independent
// interest membership and delta history. Immediate same-tick updates stay fresh.
{
  const world = createWorld();
  const ships = [0, 100, 200].map((x, index) =>
    addEntity(
      world,
      createShip(world, { playerId: index + 1, position: Vec.create(x, 0) }),
    ),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      position: Vec.create(300, 0),
      radius: 40,
    }),
  );
  const cached = ships.map(() => new ReplicationManager());
  const reference = ships.map(() => new ReplicationManager());
  let reads = 0;

  Object.defineProperty(asteroid, 'pointCount', {
    get() {
      reads++;
      return 5;
    },
  });
  const compare = () => {
    const replicationRecords = new Map();
    let preparedReads = 0;

    ships.forEach((ship, index) => {
      const options = { world, shipId: ship.id };
      const before = reads;
      const actual = cached[index].snapshot({ ...options, replicationRecords });

      preparedReads += reads - before;
      assert.deepEqual(
        JSON.stringify(actual),
        JSON.stringify(reference[index].snapshot(options)),
      );
    });
    return preparedReads;
  };

  assert.equal(
    compare(),
    1,
    'overlapping views prepare the asteroid only once',
  );
  Vec.setXY(asteroid.velocity, 10, 20);
  compare();
  Vec.setXY(asteroid.velocity, 0, 0);
  compare();
  ships[0].credits += 10;
  const immediate = { world, shipId: ships[0].id };

  assert.deepEqual(
    cached[0].snapshot(immediate),
    reference[0].snapshot(immediate),
    'an immediate update in the same world tick does not reuse old preparation',
  );
  assert.ok(cached[0].snapshot(immediate).fullEntities.length === 0);
  Vec.setXY(ships[1].position, 20000, 0);
  compare();
  ships[2].credits += 1;
  compare();
  Vec.setXY(ships[1].position, 100, 0);
  compare();
  world.entities.delete(asteroid.id);
  compare();
}

// Frozen geometry may be shared in snapshot history, but damage, cargo and
// mutable replacement vertices must still produce deltas for each receiver.
for (const locked of [false, true]) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  const rock = addEntity(
    world,
    createAsteroid(world, { radius: 40, position: Vec.clone(ship.position) }),
  );

  if (locked) rock.lockGeometry();
  rock.segments[0].health--;
  const replication = new ReplicationManager();
  const options = { world, shipId: ship.id };
  const initial = JSON.parse(JSON.stringify(replication.initial(options)));

  assert(initial.fullEntities.find(({ id }) => id === rock.id).segments);
  assert(
    !replication
      .snapshot(options)
      .fullEntities.some(({ id }) => id === rock.id),
  );

  for (const mutate of [
    () => {
      rock.segments[0].health--;
    },
    () => {
      rock.segments[0].contents.push(3);
    },
    () => {
      rock.segments = rock.segments.map((segment) => ({
        ...segment,
        shapeOutline: segment.shapeOutline.map((point) => [...point]),
      }));
      rock.segments[0].shapeOutline[0][0]++;
    },
  ]) {
    mutate();
    const update = replication
      .snapshot(options)
      .fullEntities.find(({ id }) => id === rock.id);

    assert(update.segments);
    assert.deepEqual(update.segments, rock.segments);
    assert(
      !replication
        .snapshot(options)
        .fullEntities.some(({ id }) => id === rock.id),
    );
  }
}

// Persistent records must observe in-place changes, clears, independent cursors
// and replacement objects even when they share an entity ID or world tick.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  let rock = addEntity(world, createAsteroid(world, { radius: 40 }));
  const observers = [new ReplicationManager(), new ReplicationManager()];
  const options = { world, shipId: ship.id };

  observers.forEach((observer) => observer.initial(options));
  rock.label = 'changed';
  observers[0].snapshot(options);
  rock.label = undefined;
  Vec.setXY(rock.velocity, 10, 20);

  for (const observer of observers) {
    const delta = observer
      .snapshot(options)
      .fullEntities.find(({ id }) => id === rock.id);

    assert.deepEqual(delta.velocity, { x: 10, y: 20 });
    assert.equal(delta.label, null);
    assert.equal(observer.snapshot(options).fullEntities.length, 0);
  }
  rock = addEntity(world, createAsteroid(world, { id: rock.id, radius: 60 }));

  for (const observer of observers) {
    const delta = observer
      .snapshot(options)
      .fullEntities.find(({ id }) => id === rock.id);

    assert.equal(delta.kind, 'asteroid');
    assert.equal(delta.radius, 60);
    assert.equal(
      delta.velocity,
      null,
      'same-ID replacements clear old motion defaults',
    );
  }
  const module = ship.modules[0];
  const checkModules = () => {
    const expected = ship.moduleStates.map((state, index) => ({
      ...state,
      id: ship.modules[index].id,
    }));

    for (const observer of observers) {
      const packet = observer.snapshot(options);
      const actual = packet.fullEntities.find(
        ({ id }) => id === ship.id,
      )?.modules;

      assert.deepEqual(
        JSON.parse(JSON.stringify(actual)),
        JSON.parse(JSON.stringify(expected)),
      );
      assert.equal(observer.snapshot(options).fullEntities.length, 0);
    }
  };

  module.mount.health--;
  checkModules();
  ship.segmentsAtMount(module.mount)[0].activationProgress = 0.375;
  checkModules();
  module.shades = ['red', 'green', 'blue'];
  checkModules();
  module.shades[1] = 'yellow';
  checkModules();
  module.id++;
  checkModules();
}
