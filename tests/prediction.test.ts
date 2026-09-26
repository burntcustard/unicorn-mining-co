import * as Vec from '../src/shared/vector';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { GameServer } from '../src/server/game-server';
import {
  asteroidContact,
  createAsteroid,
  shapeOutlineOf,
} from '../src/shared/simulation/asteroid';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { type ReplicatedEntity } from '../src/shared/protocol/network';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../src/shared/simulation/world';
import { createShip } from '../src/shared/craft/create-ship';
import { createStation } from '../src/shared/craft/create-station';
import { Diamond } from '../src/shared/items';
import { cloneEntity } from '../src/shared/simulation/world-state';
import { updateWorld } from '../src/shared/simulation/update-world';
import { PredictionManager } from '../src/client/prediction';
import { RemoteMotion } from '../src/client/remote-motion';
import { ReplicationManager } from '../src/server/replication';
import { detectCollisions } from '../src/shared/collision/detect-collisions';
import { GameObject } from '../src/shared/game-object';
import { CargoHatch } from '../src/shared/modules/cargo-hatch';
import { simulationStep, updateTiers } from '../src/shared/settings';

// Scenery and loose cargo need render-rate poses too, including the slow tier.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  const rock = addEntity(
    world,
    createAsteroid(world, { id: 2, position: Vec.create(700), radius: 30 }),
  );
  const item = addEntity(
    world,
    new Diamond({ world, id: 3, position: Vec.create(800) }),
  );
  const station = addEntity(
    world,
    createStation({ world, id: 4, position: Vec.create(8000) }),
  );
  const motion = new RemoteMotion();
  const replication = new ReplicationManager();
  const records = new Map<number, ReplicatedEntity>();
  const receive = (now: number) => {
    const packet = replication.snapshot({ world, shipId: ship.id });
    // RemoteMotion receives complete records after NetworkClient expands deltas.
    const entities = packet.fullEntities.map((entity) => {
      const full = { ...records.get(entity.id), ...entity };

      records.set(entity.id, full);
      return full;
    });

    const entityIds = packet.entityIds ?? [...records.keys()];

    records.forEach((_, id) => {
      if (!entityIds.includes(id)) records.delete(id);
    });
    motion.receive({
      entities,
      entityIds,
      shipId: ship.id,
      tick: world.tick,
      now,
    });
  };

  receive(0);
  world.tick = 1;

  for (const entity of [rock, item]) {
    entity.position.x += 10;
    entity.rotation += 0.1;
  }
  receive(1000 / 30);
  let last = -Infinity;

  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const poses = motion.sample({ now: ((1 + fraction) * 1000) / 30 });

    for (const entity of [rock, item]) {
      const pose = poses.get(entity.id)!;

      assert(
        Math.abs(pose.position.x - (entity.position.x - 10 + 10 * fraction)) <
          1e-8,
      );
      assert(
        Math.abs(pose.rotation - (entity.rotation - 0.1 + 0.1 * fraction)) <
          1e-8,
      );
    }
    assert(
      poses.get(rock.id)!.position.x > last,
      'scenery advances on intermediate frames',
    );
    last = poses.get(rock.id)!.position.x;
  }
  world.tick = 4;
  station.rotation += 0.4;
  receive(4000 / 30);

  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const pose = motion
      .sample({ now: ((4 + 4 * fraction) * 1000) / 30 })
      .get(station.id)!;

    assert(
      Math.abs(pose.rotation - (station.rotation - 0.4 + 0.4 * fraction)) <
        1e-8,
      'distant stations interpolate over their own snapshot interval',
    );
  }
  assert.equal(
    motion.sample({ now: 1000 }).get(station.id)!.rotation,
    station.rotation,
    'slow-tier interpolation reaches the endpoint when packets stop',
  );
  world.entities.delete(rock.id);
  world.tick = 5;
  receive(1000);
  assert(
    !motion.sample().has(rock.id),
    'destroyed/unloaded scenery has no stale pose',
  );
}

// Rendering predicts the unfinished tick, not the previous tick's pose.
// Sampling more frames must not advance history or change the eventual solve.
for (const fps of [60, 120, 144]) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  addEntity(world, new GameObject({ id: 100, position: Vec.create(8000) }));
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const input = { ...emptyPlayerInput(), thrust: 1, turn: -1 };
  let messages = 0;
  const send = () => {
    messages++;
  };

  prediction.recordInput({ input, offset: 0.001, send });
  const frame = prediction.predictFrame({ elapsed: 1 / fps });
  const drawn = frame.entities.get(ship.id)!;

  assert(
    Vec.length(drawn.velocity) > 0,
    `${fps} FPS: thrust reacts this frame`,
  );
  assert(drawn.rotation < 0, `${fps} FPS: steering reacts this frame`);
  assert.equal(world.tick, 0, 'frames do not consume a network tick');
  assert.equal(ship.rotation, 0, 'frames do not mutate committed history');
  assert.equal(Vec.length(ship.velocity), 0);
  assert(!frame.entities.has(100), 'distant objects are not copied each frame');
  const position = Vec.add(drawn.position, Vec.create());
  const rotation = drawn.rotation;
  const repeated = prediction
    .predictFrame({ elapsed: 1 / fps })
    .entities.get(ship.id)!;

  assert(Vec.distance(position, repeated.position) < 1e-9);
  assert.equal(
    repeated.rotation,
    rotation,
    'resampling does not accumulate drift',
  );

  prediction.recordInput({ input: emptyPlayerInput(), offset: 0.018, send });
  const released = prediction
    .predictFrame({ elapsed: 0.024 })
    .entities.get(ship.id)!;

  assert.equal(released.turn, 0, 'release is applied before the network tick');
  assert.equal(released.thrust, 0);
  const endpoint = prediction
    .predictFrame({ elapsed: simulationStep })
    .entities.get(ship.id)!;
  const endPosition = Vec.add(endpoint.position, Vec.create());
  const endRotation = endpoint.rotation;
  const stalled = prediction
    .predictFrame({ elapsed: 2 })
    .entities.get(ship.id)!;

  assert(
    Vec.distance(stalled.position, endPosition) < 1e-9,
    'a stalled connection cannot predict beyond one unfinished tick',
  );
  prediction.step({ input: emptyPlayerInput(), send });
  assert(Vec.distance(ship.position, endPosition) < 1e-9);
  assert.equal(
    ship.rotation,
    endRotation,
    'frame endpoint equals committed physics',
  );
  assert.equal(messages, 2, 'rendering does not send more network messages');
  const corrected = cloneEntity({ entity: ship });

  corrected.position.x += 100;
  prediction.reconcile({ tick: world.tick, entities: [corrected] });
  assert.equal(
    prediction.predictFrame({ elapsed: 0 }).entities.get(ship.id)!.position.x,
    corrected.position.x,
    'a correction invalidates the cached frame even at the same tick',
  );
}

// Two immediate transitions in one tick must retain the duration of a short tap.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const sent: { offset: number; input: ReturnType<typeof emptyPlayerInput> }[] =
    [];
  const send = (message: (typeof sent)[number]) => {
    sent.push(message);
  };

  prediction.recordInput({
    input: { ...emptyPlayerInput(), thrust: 1 },
    offset: 0.005,
    send,
  });
  prediction.recordInput({ input: emptyPlayerInput(), offset: 0.015, send });
  assert.equal(
    sent.length,
    2,
    'both transitions are sent before simulation runs',
  );
  prediction.step({ input: emptyPlayerInput(), send });
  assert(
    Vec.length(ship.velocity) > 0,
    'a released short tap still produces movement',
  );
  assert.equal(ship.thrust, 0);
  const expected = createWorld();
  const authoritative = addEntity(
    expected,
    createShip(expected, { playerId: 1 }),
  );

  addPlayer(expected, { id: 1, shipId: authoritative.id });
  updateWorld({
    world: expected,
    inputs: new Map([[1, { input: emptyPlayerInput(), changes: sent }]]),
  });
  assert(Vec.distance(ship.position, authoritative.position) < 1e-9);
  assert(Vec.distance(ship.velocity, authoritative.velocity) < 1e-9);
}

// A server hatch correction must apply even when the ship's motion matches.
// Rapid toggles can leave the command and animation at different stages.
for (const { active, progress } of [
  { active: 0, progress: 0 },
  { active: 1, progress: 0.15 },
]) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const open = { ...emptyPlayerInput(), cargoHatch: true };

  for (let tick = 0; tick < 8; tick++) {
    prediction.step({ input: open, send() {} });
  }
  const authoritative = cloneEntity({ entity: ship }) as typeof ship;

  authoritative.segments
    .filter((segment) => segment.module instanceof CargoHatch)
    .forEach((segment) => {
      segment.active = active;
      segment.activationProgress = progress;
    });
  prediction.step({ input: emptyPlayerInput(), send() {} });
  prediction.reconcile({ tick: 8, entities: [authoritative] });

  const hatches = ship.segments.filter(
    (segment) => segment.module instanceof CargoHatch,
  );
  const expected = Math.max(0, progress - simulationStep / 0.7);

  assert(hatches.length > 0);
  hatches.forEach((segment) => {
    assert.equal(segment.active, 0);
    assert(
      Math.abs(segment.activationProgress - expected) < 1e-8,
      'hatch animation resumes from the server state after reconciliation',
    );
  });
}

// Station snapshots can change credits or cargo without changing ship motion.
for (const correction of ['credits', 'cargo'] as const) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  prediction.step({ input: emptyPlayerInput(), send() {} });
  prediction.step({ input: emptyPlayerInput(), send() {} });
  const authoritative = cloneEntity({ entity: ship }) as typeof ship;

  if (correction === 'credits') {
    authoritative.credits += CargoHatch.price;
  } else {
    authoritative.cargoContents.push(new Diamond({ world, id: 1000 }));
  }
  prediction.step({ input: emptyPlayerInput(), send() {} });
  prediction.reconcile({ tick: 2, entities: [authoritative] });

  assert.equal(ship.credits, authoritative.credits);
  assert.deepEqual(
    ship.cargoContents.map(({ id }) => id),
    authoritative.cargoContents.map(({ id }) => id),
    `${correction} from the server reaches the predicted ship`,
  );
}

// A clock reset must not leave a future input waiting to reactivate thrust.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  world.tick = 10;
  prediction.step({ input: { ...emptyPlayerInput(), thrust: 1 }, send() {} });
  world.tick = 0;
  prediction.reset();

  for (let tick = 0; tick < 12; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
  }
  assert.equal(
    ship.thrust,
    0,
    'old future input must not come back after clock recovery',
  );
}

{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const drifting = addEntity(
    world,
    new GameObject({ id: 99, position: Vec.create(500), spin: 1 }),
  );
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  world.tick = 6;
  prediction.reconcile({
    tick: 6,
    entities: [
      cloneEntity({ entity: ship }),
      cloneEntity({ entity: drifting }),
    ],
    entityTicks: new Map([
      [ship.id, 6],
      [drifting.id, 2],
    ]),
  });
  assert(
    Math.abs(drifting.rotation - 4 / 30) < 1e-4,
    'batched slow-tier state retains its own original tick',
  );
  const checkpoint = [...world.entities.values()].map((entity) =>
    cloneEntity({ entity }),
  );

  for (let tick = 0; tick < 40; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
  }
  prediction.reconcile({ tick: 6, entities: checkpoint });
  assert.equal(
    world.tick,
    6,
    'a large drift rebases instead of replaying dozens of ticks',
  );
}

// A remote correction can cause contact even while the pilot's checkpoint
// still matches. Replay the pair together, as the authoritative solver does.
for (const localId of [1, 2]) {
  const world = createWorld();

  addEntity(
    world,
    createShip(world, {
      id: 1,
      playerId: 1,
      position: Vec.create(-85),
      velocity: Vec.create(300),
    }),
  );
  addEntity(
    world,
    createShip(world, {
      id: 2,
      playerId: 2,
      position: Vec.create(),
      rotation: Math.PI,
    }),
  );
  addPlayer(world, { id: localId, shipId: localId });
  const checkpoint = [...world.entities.values()].map((entity) =>
    cloneEntity({ entity }),
  );
  const remote = checkpoint.find((entity) => entity.id !== localId)!;

  remote.position.x += localId === 1 ? -20 : 20;
  const expected = createWorld();

  checkpoint.forEach((entity) => addEntity(expected, cloneEntity({ entity })));
  addPlayer(expected, { id: localId, shipId: localId });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: localId });

  for (let tick = 0; tick < 2; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
    updateWorld({ world: expected, inputs: new Map() });
  }
  prediction.reconcile({ entities: checkpoint, tick: 0 });

  for (const id of [1, 2]) {
    const actual = world.entities.get(id)!;
    const correct = expected.entities.get(id)!;

    assert(
      Vec.distance(actual.position, correct.position) < 1e-8,
      `player ${localId}: ship ${id} must replay the collision, not coast through it`,
    );
    assert(Vec.distance(actual.velocity, correct.velocity) < 1e-8);
  }
  // Both pilots must see the same geometry that their own solver just used.
  const motion = new RemoteMotion();
  const replication = new ReplicationManager();
  const packet = replication.initial({ world, shipId: localId });

  assert(packet.type === 'load');
  motion.receive({
    entities: packet.fullEntities,
    entityIds: packet.fullEntities.map((entity) => entity.id),
    shipId: localId,
    tick: world.tick,
    now: 0,
  });
  const local = world.entities.get(localId)!;
  const other = world.entities.get(localId === 1 ? 2 : 1)!;

  local.position.x += 8;
  other.position.x += 8;
  assert(
    Vec.distance(
      motion.sample({ now: 0 }).get(other.id)!.position,
      other.position,
    ) > 7,
    'delaying only the other hull produces the original contact disparity',
  );
  const pose = motion.sample({ now: 0, world, shipId: localId }).get(other.id)!;

  assert(
    Vec.distance(pose.position, other.position) < 1e-8,
    'contact presentation uses the collision position for both pilots',
  );
  const physicsPositions = [local.position.x, other.position.x];

  for (const elapsed of [1 / 144, 1 / 120, 1 / 60, simulationStep]) {
    const predicted = prediction.predictFrame({ elapsed });
    const poses = motion.sample({ now: 0, world, predicted, shipId: localId });

    for (const entity of [local, other]) {
      assert(
        Vec.distance(
          poses.get(entity.id)!.position,
          predicted.entities.get(entity.id)!.position,
        ) < 1e-8,
        'local and contacting remote ships use the same frame collision solve',
      );
    }
  }
  assert.deepEqual(
    [local.position.x, other.position.x],
    physicsPositions,
    'sampling presentation must not move physics bodies',
  );
  const endpoint = prediction.predictFrame({ elapsed: simulationStep });
  const framePositions = new Map(
    [...endpoint.entities].map(([id, entity]) => [
      id,
      Vec.add(entity.position, Vec.create()),
    ]),
  );

  prediction.step({ input: emptyPlayerInput(), send() {} });

  for (const id of [1, 2]) {
    assert(
      Vec.distance(world.entities.get(id)!.position, framePositions.get(id)!) <
        1e-8,
      'fractional contact prediction ends at the same solved tick',
    );
  }
  const beforeDock = local.position.x;

  local.dockedTo = 123;
  local.position.x += 500;
  assert.equal(
    motion.sample({ world, shipId: localId }).get(localId)!.position.x,
    beforeDock + 500,
    'docking resets presentation instead of interpolating through the station',
  );
}
console.log(
  'Both collision perspectives replay shared physics and render matching contact poses',
);

const server = new GameServer({ port: 0, worldSeed: 4242 });
const listener = server.start();

await once(listener, 'listening');
const address = listener.address();

assert(address && typeof address !== 'string');

// The client module reaches for the browser as it loads, so stand in for the
// parts of it the network client actually touches.
const stored = new Map<string, string>();

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  },
  location: { host: `127.0.0.1:${address.port}`, protocol: 'http:' },
});

const { network, NetworkClient } = await import('../src/client/network');
const { predictionStats } = await import('../src/client/prediction');

await network.ready;
stored.delete('playerToken');
const observer = new NetworkClient({ url: `ws://127.0.0.1:${address.port}` });

await observer.ready;

const input = emptyPlayerInput();
const step = simulationStep * 1000;
// The prediction only earns its keep against the clock the server keeps, so
// this runs in real time rather than as fast as it can.
let paused = false;
const pilot = setInterval(() => {
  if (!paused) network.update({ input });
}, step);
const observing = setInterval(
  () => observer.update({ input: emptyPlayerInput() }),
  step,
);

const fly = async ({ ticks }: { ticks: number }) =>
  new Promise((resolve) => setTimeout(resolve, ticks * step));

await fly({ ticks: 60 });
// Hold one browser's socket callbacks during a stall, then deliver the entire
// backlog. Receipt should accumulate state, not replay once per old packet.
const socket = Reflect.get(network, 'socket') as WebSocket;
const receive = socket.onmessage!;
const backlog: MessageEvent[] = [];

socket.onmessage = (event) => backlog.push(event);
paused = true;
await fly({ ticks: 45 });
// Also reproduce frame catch-up running before the queued socket callbacks.

for (let tick = 0; tick < 40; tick++) network.update({ input });
const stepsBeforeBacklog = predictionStats.steps;

socket.onmessage = receive;

for (const message of backlog) receive.call(socket, message);
assert(
  backlog.length > 10,
  'the stall must accumulate a real snapshot backlog',
);
assert.equal(
  predictionStats.steps,
  stepsBeforeBacklog,
  'queued socket callbacks must not replay worlds',
);
network.update({ input });
assert(
  predictionStats.steps - stepsBeforeBacklog <= 6,
  'recovery must bound replay plus the current update',
);
assert(
  Math.abs(network.world.tick - network.serverTick - 1) <= 1,
  'the recovered clock returns to the one-tick lead with phase tolerance',
);
paused = false;
await fly({ ticks: 30 });
assert.equal(network.world.entities.get(network.shipId!)!.thrust, 0);
console.log(`Recovered ${backlog.length} queued snapshots in one update`);
Object.assign(predictionStats, { corrections: 0, steps: 0, worst: 0 });

const shipId = network.shipId!;
// A correction rebuilds the world's entities, so the ship is looked up afresh
// rather than held on to.
const predicted = () => {
  const ship = network.world.entities.get(shipId);

  assert(ship?.kind === 'ship');
  return ship;
};
const from = Vec.add(predicted().position, Vec.create());

input.thrust = 1;
await fly({ ticks: 120 });
input.turn = 1;
// Exercise the existing flight with a missed run of owner frames while the
// server and observer keep running, then change input on resumption.
paused = true;
await fly({ ticks: 12 });
network.update({ input });
paused = false;
await fly({ ticks: 30 });
let worstRotationError = 0;
let worstPositionError = 0;

for (let sample = 0; sample < 10; sample++) {
  await fly({ ticks: 3 });
  const remote = observer.world.entities.get(shipId);

  assert(remote, 'the second client must see the turning ship');
  const own = cloneEntity({ entity: predicted() });
  const seen = cloneEntity({ entity: remote });
  const tickDifference = network.world.tick - observer.world.tick;

  assert(
    Math.abs(tickDifference) <= 2,
    'independent client clocks stay bounded',
  );
  // Independent timers can straddle a server tick. Compare the same simulation
  // time rather than treating two ticks of correct turning as a rotation error.
  const earlier = tickDifference > 0 ? seen : own;

  for (let tick = 0; tick < Math.abs(tickDifference); tick++) {
    for (let part = 0; part < updateTiers.visible.substeps; part++) {
      earlier.update(simulationStep / updateTiers.visible.substeps);
    }
  }
  const error = Math.abs(
    Math.atan2(
      Math.sin(seen.rotation - own.rotation),
      Math.cos(seen.rotation - own.rotation),
    ),
  );

  worstRotationError = Math.max(worstRotationError, error);
  worstPositionError = Math.max(
    worstPositionError,
    Vec.distance(seen.position, own.position),
  );
}
assert(
  worstRotationError < 0.12,
  `same-tick rotation error ${worstRotationError}; client ticks ${network.world.tick}/${observer.world.tick}`,
);
assert(
  worstPositionError < predicted().maxSpeed / 30,
  `same-tick position error ${worstPositionError} exceeds one tick of travel`,
);
input.turn = 0;
await fly({ ticks: 60 });
input.thrust = 0;
await fly({ ticks: 30 });
// Short taps used to extrapolate past the stop, then jump backwards when the
// release reached the observer. Check the presentation path, not just physics.

for (const separation of [160, 1000]) {
  const authority = server.world.entities.get(shipId)!;
  const other = server.world.entities.get(observer.shipId!)!;
  const worstBeforeTeleport = predictionStats.worst;

  Vec.set(
    other.position,
    Vec.add(authority.position, Vec.create(0, separation)),
  );
  Vec.set(other.velocity, Vec.create());
  await fly({ ticks: 30 });
  // The observer's deliberate teleport is not a prediction error from flight.
  predictionStats.worst = worstBeforeTeleport;

  for (const ticks of [18, 30]) {
    let previous = observer.remoteMotion
      .sample({ world: observer.world, shipId: observer.shipId })
      .get(shipId)!.rotation;
    let worstBackstep = 0;
    const sampling = setInterval(() => {
      const pose = observer.remoteMotion
        .sample({ world: observer.world, shipId: observer.shipId })
        .get(shipId)!;
      const change = Math.atan2(
        Math.sin(pose.rotation - previous),
        Math.cos(pose.rotation - previous),
      );

      worstBackstep = Math.max(worstBackstep, -change);
      previous = pose.rotation;
    }, 8);

    input.turn = 1;
    await fly({ ticks });
    input.turn = 0;
    await fly({ ticks: 40 });
    clearInterval(sampling);
    assert(
      worstBackstep < 0.002,
      `${separation}m/${ticks}tick tap reversed by ${worstBackstep} radians`,
    );
    const pose = observer.remoteMotion
      .sample({ world: observer.world, shipId: observer.shipId })
      .get(shipId)!;

    assert(
      Math.abs(pose.rotation - authority.rotation) < 0.01,
      'the buffered ship reaches the authoritative stop',
    );
  }
}
clearInterval(pilot);
clearInterval(observing);
const stoppedRemote = observer.world.entities.get(shipId)!;

assert(
  Math.abs(stoppedRemote.rotation - predicted().rotation) < 0.01,
  'both clients agree after steering stops too',
);
console.log(
  `Two-client turning: worst same-tick rotation error ${worstRotationError.toFixed(4)} radians, position error ${worstPositionError.toFixed(3)} units`,
);

const authority = server.world.entities.get(shipId);
const client = predicted();

assert(authority?.kind === 'ship');
assert(
  Vec.distance(client.position, from) > 100,
  'the ship should have flown somewhere',
);
assert(
  predictionStats.steps > 180,
  `the client should have simulated in step with the server, got ${predictionStats.steps}`,
);

// The whole point of the split: the client leads the server by enough for its
// input to reach the tick it was stamped with, so the server never has to
// argue with what the client already drew.
assert(
  network.world.tick > network.serverTick,
  `the client should predict ahead of the server, got ${
    network.world.tick - network.serverTick
  } ticks`,
);
assert(
  predictionStats.worst < 1,
  `the server corrected the predicted ship by ${predictionStats.worst} units`,
);

// The authoritative ship is only as far behind as the ticks the client is
// predicting ahead of it can carry a ship.
const leading = network.world.tick - network.serverTick;

assert(
  Vec.distance(authority.position, client.position) <
    ((leading + 6) * client.maxSpeed) / 30,
  `the authoritative ship trailed the predicted one by ${Vec.distance(authority.position, client.position)} units over ${leading} ticks`,
);

// Flying into a rock: both sides have to agree on the shape of it, not just
// on the circle that bounds it, or the ship stops short of what is drawn.
const settling = setInterval(() => network.update({ input }), step);

input.thrust = 0;
input.turn = 0;
Vec.set(authority.velocity, Vec.create());
authority.spin = 0;
await fly({ ticks: 30 });

// Keep the shape-contact fixture clear of procedural scenery. Field density
// varies by seed, and this test needs the inserted rock to be the first hit.
server.world.entities.forEach((entity, id) => {
  if (
    entity.kind !== 'ship' &&
    Vec.distance(entity.position, authority.position) < 1500
  ) {
    server.world.entities.delete(id);
  }
});

const rock = addEntity(
  server.world,
  createAsteroid(server.world, {
    position: Vec.add(
      authority.position,
      Vec.scale(
        Vec.create(Math.cos(authority.rotation), Math.sin(authority.rotation)),
        700,
      ),
    ),
    radius: 150,
  }),
);
// Turn its deepest face towards the ship, so where it comes to rest tells the
// rock's own shape apart from the circle that merely bounds it.
const shapeOutline = shapeOutlineOf(rock);
const faces = shapeOutline.map(([x, y], i) => {
  const [toX, toY] = shapeOutline[(i + 1) % shapeOutline.length];

  return Vec.create((x + toX) / 2, (y + toY) / 2);
});
const deepest = faces.reduce((best, face) =>
  Vec.length(face) < Vec.length(best) ? face : best,
);
const towards = Vec.subtract(authority.position, rock.position);

rock.rotation =
  Math.atan2(towards.y, towards.x) - Math.atan2(deepest.y, deepest.x);
rock.spin = 0;

Object.assign(predictionStats, { corrections: 0, steps: 0, worst: 0 });
input.thrust = 1;
await fly({ ticks: 240 });
clearInterval(settling);

const resting = server.world.entities.get(shipId);

assert(resting?.kind === 'ship');
const gap = Vec.distance(resting.position, rock.position);

assert(
  gap < rock.radius + resting.radius - 15,
  `the ship stopped ${gap} units out, no nearer than the ${
    rock.radius + resting.radius
  } unit circle bounding a rock it should have come right up against`,
);
assert(
  asteroidContact({
    asteroid: rock,
    position: resting.position,
    // The Mustang's horn drill reaches seven units beyond its nominal hull radius.
    radius: resting.radius + 10,
  }),
  'the ship should be resting against the rock it is drawn against',
);
assert(
  !asteroidContact({
    asteroid: rock,
    position: resting.position,
    radius: resting.radius - 3,
  }),
  'the ship should be resting against the rock, not sunk into it',
);
assert(
  predictionStats.worst < 6,
  `the collision was predicted ${predictionStats.worst} units out`,
);

// Drive a real authoritative ship-to-ship bump over both socket connections.
// Clear a small test arena and reset damaged hulls from the drilling approach.
const centre = Vec.add(resting.position, Vec.create(0, 400));
const worstBeforeArenaReset = predictionStats.worst;

server.world.entities.forEach((entity, id) => {
  if (
    entity.playerId === undefined &&
    Vec.distance(entity.position, centre) < 600
  ) {
    server.world.entities.delete(id);
  }
});
const attacker = addEntity(
  server.world,
  createShip(server.world, {
    id: shipId,
    playerId: network.playerId,
    position: Vec.add(centre, Vec.create(-220)),
    rotation: 0,
  }),
);
const target = addEntity(
  server.world,
  createShip(server.world, {
    id: observer.shipId,
    playerId: observer.playerId,
    position: Vec.add(centre, Vec.create()),
    rotation: Math.PI,
  }),
);

input.thrust = 0;
const bumping = setInterval(() => {
  network.update({ input });
  observer.update({ input: emptyPlayerInput() });
}, step);

await fly({ ticks: 30 });
// Moving both ships into the arena is test setup, not flight misprediction.
predictionStats.worst = worstBeforeArenaReset;
const contactsSeen = new Map([
  [network, 0],
  [observer, 0],
]);
let worstContactOffset = 0;
const watching = setInterval(() => {
  for (const client of [network, observer]) {
    const own = client.world.entities.get(client.shipId!)!;
    const other = client.world.entities.get(
      client === network ? target.id : attacker.id,
    )!;

    if (!other) continue;
    const contacts = detectCollisions({ entities: [own, other] }).filter(
      (contact) =>
        contact.collider.physics !== false && contact.other.physics !== false,
    );

    if (!contacts.length) continue;
    contactsSeen.set(client, contactsSeen.get(client)! + 1);
    const pose = client.remoteMotion
      .sample({ world: client.world, shipId: client.shipId })
      .get(other.id)!;

    worstContactOffset = Math.max(
      worstContactOffset,
      Vec.distance(pose.position, other.position),
      // Interpolation can represent the identical heading one full turn apart.
      Math.abs(
        Math.atan2(
          Math.sin(pose.rotation - other.rotation),
          Math.cos(pose.rotation - other.rotation),
        ),
      ),
    );
  }
}, 8);

input.thrust = 1;
await fly({ ticks: 120 });
input.thrust = 0;
await fly({ ticks: 30 });
clearInterval(watching);
clearInterval(bumping);
assert(
  [...contactsSeen.values()].every((count) => count > 0),
  'both clients must actually simulate physical contact',
);
assert(
  Vec.distance(target.position, centre) > 1,
  'the authoritative target must receive the bump',
);
assert(
  worstContactOffset < 1e-8,
  `rendered contact differs from simulated contact by ${worstContactOffset}`,
);
console.log(
  `Ship bump: ${[...contactsSeen.values()].join('/')} contact samples by client, ${worstContactOffset.toFixed(6)} render/physics offset`,
);

const now = performance.now();
const held = observer.remoteMotion.sample({ now: now + 1000 });

assert(held.has(shipId), 'the observer retains the remote ship');
assert(!held.has(observer.shipId!), 'the local ship never gets a delayed pose');
assert.deepEqual(
  observer.remoteMotion.sample({ now: now + 2000 }),
  held,
  'missing snapshots hold their endpoint instead of extrapolating indefinitely',
);
await server.stop();
observer.remoteMotion.receive({
  entities: [],
  entityIds: [],
  tick: observer.serverTick,
});
assert.equal(
  observer.remoteMotion.sample().size,
  0,
  'unloaded ships leave no presentation history',
);
console.log(
  `prediction test passed: ${predictionStats.steps} predicted ticks, ` +
    `${predictionStats.corrections} corrections, ` +
    `${predictionStats.worst.toFixed(3)} units of worst ship correction`,
);
process.exit(0);
