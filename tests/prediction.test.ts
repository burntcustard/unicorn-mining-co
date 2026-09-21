import assert from 'node:assert/strict';
import { once } from 'node:events';
import { GameServer } from '../src/server/game-server';
import {
  asteroidContact,
  createAsteroid,
  outlineOf,
} from '../src/shared/simulation/asteroid';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { addEntity } from '../src/shared/simulation/world';
import { Vector } from '../src/vector';

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

const { network } = await import('../src/client/network');
const { predictionStats } = await import('../src/client/prediction');

await network.ready;

const input = emptyPlayerInput();
const step = 1000 / 60;
// The prediction only earns its keep against the clock the server keeps, so
// this runs in real time rather than as fast as it can.
const pilot = setInterval(() => network.update({ input }), step);

const fly = async ({ ticks }: { ticks: number }) =>
  new Promise((resolve) => setTimeout(resolve, ticks * step));

await fly({ ticks: 60 });
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
await fly({ ticks: 60 });
input.turn = 0;
await fly({ ticks: 60 });
clearInterval(pilot);

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
    radius: resting.radius + 2,
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
  predictionStats.worst < 1,
  `the collision was predicted ${predictionStats.worst} units out`,
);

await server.stop();
console.log(
  `prediction test passed: ${predictionStats.steps} predicted ticks, ` +
    `${predictionStats.corrections} corrections, ` +
    `${predictionStats.worst.toFixed(3)} units of worst ship correction`,
);
process.exit(0);
