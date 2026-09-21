import assert from 'node:assert/strict';
import { once } from 'node:events';
import { GameServer } from '../src/server/game-server';
import {
  asteroidContact,
  createAsteroid,
  outlineOf,
} from '../src/shared/simulation/asteroid';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../src/shared/simulation/world';
import { createShip } from '../src/shared/craft/create-ship';
import {
  cloneEntity,
  captureWorld,
  restoreWorld,
} from '../src/shared/simulation/world-state';
import { updateWorld } from '../src/shared/simulation/update-world';
import { PredictionManager } from '../src/client/prediction';
import { RemoteMotion } from '../src/client/remote-motion';
import { ReplicationManager } from '../src/server/replication';
import { Vector } from '../src/shared/vector';
import { detectCollisions } from '../src/shared/simulation/collisions';
import { GameObject } from '../src/shared/game-object';

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
  for (let tick = 0; tick < 12; tick++)
    prediction.step({ input: emptyPlayerInput(), send() {} });
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
    new GameObject({ id: 99, position: Vector(500), spin: 1 }),
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
    Math.abs(drifting.rotation - 4 / 60) < 1e-9,
    'batched slow-tier state retains its own original tick',
  );
  const checkpoint = [...world.entities.values()].map((entity) =>
    cloneEntity({ entity }),
  );
  for (let tick = 0; tick < 40; tick++)
    prediction.step({ input: emptyPlayerInput(), send() {} });
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
      position: Vector(-85),
      velocity: Vector(300),
    }),
  );
  addEntity(
    world,
    createShip(world, {
      id: 2,
      playerId: 2,
      position: Vector(),
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
  restoreWorld({
    world: expected,
    state: {
      ...captureWorld({ world }),
      entities: new Map(
        checkpoint.map((entity) => [entity.id, cloneEntity({ entity })]),
      ),
    },
  });
  const prediction = new PredictionManager({ world });
  prediction.setLocalPlayer({ playerId: localId });
  for (let tick = 0; tick < 2; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
    updateWorld(expected, new Map());
  }
  prediction.reconcile({ entities: checkpoint, tick: 0 });
  for (const id of [1, 2]) {
    const actual = world.entities.get(id)!;
    const correct = expected.entities.get(id)!;
    assert(
      actual.position.distanceTo(correct.position) < 1e-8,
      `player ${localId}: ship ${id} must replay the collision, not coast through it`,
    );
    assert(actual.velocity.distanceTo(correct.velocity) < 1e-8);
  }
  // Both pilots must see the same geometry that their own solver just used.
  const motion = new RemoteMotion();
  const replication = new ReplicationManager();
  const packet = replication.initial({ world, shipId: localId });
  assert(packet.type === 'load');
  motion.receive({
    entities: packet.fullEntities,
    entityIds: packet.entityIds,
    shipId: localId,
    tick: world.tick,
    now: 0,
  });
  const local = world.entities.get(localId)!;
  const other = world.entities.get(localId === 1 ? 2 : 1)!;
  local.position.x += 8;
  other.position.x += 8;
  assert(
    motion
      .sample({ now: 0 })
      .get(other.id)!
      .position.distanceTo(other.position) > 7,
    'delaying only the other hull produces the original contact disparity',
  );
  const pose = motion.sample({ now: 0, world, shipId: localId }).get(other.id)!;
  assert(
    pose.position.distanceTo(other.position) < 1e-8,
    'contact presentation uses the collision position for both pilots',
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
const step = 1000 / 60;
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
  Math.abs(network.world.tick - network.serverTick - 2) <= 1,
  'the recovered clock returns to the two-tick prediction lead',
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
const from = predicted().position.add(Vector());

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
  const seen = observer.world.entities.get(shipId);
  const own = predicted();
  assert(seen, 'the second client must see the turning ship');
  const error = Math.abs(
    Math.atan2(
      Math.sin(seen.rotation - own.rotation),
      Math.cos(seen.rotation - own.rotation),
    ),
  );
  worstRotationError = Math.max(worstRotationError, error);
  worstPositionError = Math.max(
    worstPositionError,
    seen.position.distanceTo(own.position),
  );
}
assert(
  worstRotationError < 0.12,
  `raw rotation error ${worstRotationError}; client ticks ${network.world.tick}/${observer.world.tick}`,
);
assert(
  worstPositionError < predicted().maxSpeed / 30,
  `raw position error ${worstPositionError} exceeds two ticks of travel`,
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
  other.position.set(authority.position.add(Vector(0, separation)));
  other.velocity.set(Vector());
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
  `Two-client turning: worst raw rotation error ${worstRotationError.toFixed(4)} radians, position error ${worstPositionError.toFixed(3)} units`,
);

const authority = server.world.entities.get(shipId);
const client = predicted();

assert(authority?.kind === 'ship');
assert(
  client.position.distanceTo(from) > 100,
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
  authority.position.distanceTo(client.position) <
    ((leading + 6) * client.maxSpeed) / 60,
  `the authoritative ship trailed the predicted one by ${authority.position.distanceTo(
    client.position,
  )} units over ${leading} ticks`,
);

// Flying into a rock: both sides have to agree on the shape of it, not just
// on the circle that bounds it, or the ship stops short of what is drawn.
const settling = setInterval(() => network.update({ input }), step);

input.thrust = 0;
input.turn = 0;
authority.velocity.set(Vector());
authority.spin = 0;
await fly({ ticks: 30 });

const rock = addEntity(
  server.world,
  createAsteroid(server.world, {
    position: authority.position.add(
      Vector(Math.cos(authority.rotation), Math.sin(authority.rotation)).scale(
        700,
      ),
    ),
    radius: 150,
  }),
);
// Turn its deepest face towards the ship, so where it comes to rest tells the
// rock's own shape apart from the circle that merely bounds it.
const outline = outlineOf(rock);
const faces = outline.map(([x, y], i) => {
  const [toX, toY] = outline[(i + 1) % outline.length];

  return Vector((x + toX) / 2, (y + toY) / 2);
});
const deepest = faces.reduce((best, face) =>
  face.length() < best.length() ? face : best,
);
const towards = authority.position.subtract(rock.position);

rock.rotation =
  Math.atan2(towards.y, towards.x) - Math.atan2(deepest.y, deepest.x);
rock.spin = 0;

Object.assign(predictionStats, { corrections: 0, steps: 0, worst: 0 });
input.thrust = 1;
await fly({ ticks: 240 });
clearInterval(settling);

const resting = server.world.entities.get(shipId);

assert(resting?.kind === 'ship');
const gap = resting.position.distanceTo(rock.position);

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
    // The Mustang's horn reaches seven units beyond its nominal hull radius.
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
// Clear a small test arena and reset damaged hulls from the mining approach.
const centre = resting.position.add(Vector(0, 400));
const worstBeforeArenaReset = predictionStats.worst;
server.world.entities.forEach((entity, id) => {
  if (entity.playerId === undefined && entity.position.distanceTo(centre) < 600)
    server.world.entities.delete(id);
});
const attacker = addEntity(
  server.world,
  createShip(server.world, {
    id: shipId,
    playerId: network.playerId,
    position: centre.add(Vector(-220)),
    rotation: 0,
  }),
);
const target = addEntity(
  server.world,
  createShip(server.world, {
    id: observer.shipId,
    playerId: observer.playerId,
    position: centre.add(Vector()),
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
      pose.position.distanceTo(other.position),
      Math.abs(pose.rotation - other.rotation),
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
  target.position.distanceTo(centre) > 1,
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
