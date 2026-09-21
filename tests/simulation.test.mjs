/* global Buffer, process */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

assert.equal('window' in globalThis, false);
assert.equal('document' in globalThis, false);

const bundle = await rolldown({
  input: 'simulation',
  plugins: [
    {
      name: 'simulation-test-entry',
      load: (id) =>
        id === '\0simulation'
          ? `
      export * from '${process.cwd()}/src/shared/simulation/index.ts';
      export { Vector } from '${process.cwd()}/src/vector.ts';
      export { PredictionManager } from '${process.cwd()}/src/client/prediction.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'simulation' ? '\0simulation' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });
const simulation = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const {
  addEntity,
  addPlayer,
  createAsteroid,
  createShip,
  createStation,
  createWorld,
  cloneEntity,
  PredictionManager,
  updateWorld,
  Vector,
} = simulation;

const dockedMovement = () => {
  const world = createWorld({ seed: 25 });
  const station = addEntity(
    world,
    createStation({
      id: 100,
      position: Vector(),
      radius: 400,
      spin: 0,
    }),
  );
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 7,
      position: Vector(),
    }),
  );

  ship.dockedTo = station.id;
  addPlayer(world, { id: 7, shipId: ship.id });
  updateWorld(
    world,
    new Map([
      [
        7,
        {
          drill: false,
          hatch: false,
          launch: false,
          light: false,
          shield: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  );
  assert(Number.isFinite(ship.position.x));
  assert(Number.isFinite(ship.position.y));

  updateWorld(
    world,
    new Map([
      [
        7,
        {
          drill: false,
          hatch: false,
          launch: true,
          light: false,
          shield: false,
          thrust: 1,
          turn: 0,
        },
      ],
    ]),
  );
  const position = ship.position.x;

  updateWorld(
    world,
    new Map([
      [
        7,
        {
          drill: false,
          hatch: false,
          launch: false,
          light: false,
          shield: false,
          thrust: 1,
          turn: 0,
        },
      ],
    ]),
  );
  assert(ship.position.x > position);
};

const dockingShape = () => {
  const world = createWorld({ seed: 25 });
  const station = addEntity(
    world,
    createStation({
      id: 100,
      position: Vector(),
      radius: 400,
      spin: 0,
    }),
  );
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector(0, 210) }),
  );

  addPlayer(world, { id: 7, shipId: ship.id });
  updateWorld(
    world,
    new Map([
      [
        7,
        {
          drill: false,
          hatch: false,
          launch: false,
          light: false,
          shield: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  );
  assert.equal(ship.dockedTo, undefined);
  assert.equal(station.kind, 'station');
};

dockingShape();
dockedMovement();

const collisionAndThrust = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  addEntity(
    world,
    createAsteroid(world, { position: Vector(200), radius: 25 }),
  );
  addPlayer(world, { id: 7, shipId: ship.id });
  const input = {
    drill: false,
    hatch: false,
    launch: false,
    light: false,
    shield: false,
    thrust: 1,
    turn: 0,
  };
  let events = [];

  for (let i = 0; i < 120; i++) {
    events = updateWorld(world, new Map([[7, input]]));
    if (events.some(({ type }) => type === 'collision')) break;
  }

  assert.equal(ship.thrust, 1);
  assert(ship.velocity.length() > 0);
  assert(events.some(({ type }) => type === 'collision'));
};

collisionAndThrust();

const drillingDoesNotBounce = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 7,
      position: Vector(),
      velocity: Vector(10),
    }),
  );
  addEntity(world, createAsteroid(world, { position: Vector(50), radius: 25 }));
  addPlayer(world, { id: 7, shipId: ship.id });
  updateWorld(
    world,
    new Map([
      [
        7,
        {
          drill: true,
          hatch: false,
          launch: false,
          light: false,
          shield: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  );
  assert(ship.velocity.x >= 0);
};

drillingDoesNotBounce();

const diamondPickup = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      contents: [0],
      position: Vector(60),
      radius: 25,
    }),
  );

  addPlayer(world, { id: 7, shipId: ship.id });
  const drillInput = {
    drill: true,
    hatch: false,
    launch: false,
    light: false,
    shield: false,
    thrust: 1,
    turn: 0,
  };
  const miningEvents = [];
  let fracturedChunk;

  for (
    let i = 0;
    i < 900 &&
    ![...world.entities.values()].some(({ kind }) => kind === 'item');
    i++
  ) {
    miningEvents.push(...updateWorld(world, new Map([[7, drillInput]])));
    fracturedChunk ||= [...world.entities.values()].find(
      (entity) =>
        entity.kind === 'asteroid' && entity.id !== asteroid.id && entity.decay,
    );
  }

  assert.equal(world.entities.has(asteroid.id), false);
  assert(fracturedChunk?.outline?.length >= 3);
  assert.equal(
    miningEvents.some(({ type }) => type === 'asteroidMined'),
    true,
  );
  assert.deepEqual(
    miningEvents.find(({ type }) => type === 'asteroidDestroyed')?.contents,
    [0],
  );
  const item = [...world.entities.values()].find(({ kind }) => kind === 'item');

  assert.equal(item?.resource, 0);

  const pickupInput = {
    ...drillInput,
    drill: false,
    hatch: true,
    thrust: 0,
  };
  const pickupEvents = [];

  for (let i = 0; i < 120 && !ship.cargo?.length; i++)
    pickupEvents.push(...updateWorld(world, new Map([[7, pickupInput]])));

  assert.deepEqual(ship.cargo, [0]);
  assert.equal(
    [...world.entities.values()].some(({ kind }) => kind === 'item'),
    false,
  );
  assert.deepEqual(
    pickupEvents.find(({ type }) => type === 'itemCollected'),
    { by: 7, itemId: item.id, resource: 0, type: 'itemCollected' },
  );
};

diamondPickup();

const starAsteroidLosesOneArm = () => {
  const world = createWorld({ seed: 25 });
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      points: 6,
      position: Vector(60),
      radius: 25,
      radiusEven: 12,
    }),
  );

  asteroid.detach({ section: asteroid.sections[1], world });
  const pieces = [...world.entities.values()].filter(
    ({ kind }) => kind === 'asteroid',
  );
  const arm = pieces.find(({ decay }) => decay);
  const remainder = pieces.find(({ sections }) => sections?.length);

  assert.equal(world.entities.has(asteroid.id), false);
  assert.equal(arm.outline.length, 3);
  assert.equal(remainder.sections.length, 3);
};

starAsteroidLosesOneArm();

const authoritativeSnapshotReplacesPredictedSplit = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      points: 6,
      position: Vector(60),
      radius: 25,
      radiusEven: 12,
    }),
  );
  const authoritative = [ship, asteroid].map((entity) =>
    cloneEntity({ entity }),
  );
  const prediction = new PredictionManager({ world });

  asteroid.sections.forEach((section) => (section.health = 0.5));
  authoritative
    .find(({ kind }) => kind === 'asteroid')
    .sections.forEach((section) => (section.health = 0.5));
  addPlayer(world, { id: 7, shipId: ship.id });
  prediction.setLocalPlayer({ playerId: 7 });
  prediction.step({
    input: {
      drill: true,
      hatch: false,
      light: false,
      shield: false,
      thrust: 0,
      turn: 0,
    },
    send: () => {},
  });
  const predictedIds = [...world.entities.keys()].filter(
    (id) => id !== ship.id && id !== asteroid.id,
  );

  assert.equal(world.entities.has(asteroid.id), false);
  assert(predictedIds.length > 0);
  prediction.reconcile({ checkpoints: [], entities: authoritative, tick: 0 });
  assert.equal(world.entities.has(asteroid.id), true);
  assert.equal(
    predictedIds.some((id) => world.entities.has(id)),
    false,
  );
};

authoritativeSnapshotReplacesPredictedSplit();

const run = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      contents: [2],
      outline: [
        [25, 0],
        [-25, 25],
        [-25, -25],
      ],
      position: Vector(70),
      radius: 25,
    }),
  );

  addPlayer(world, { id: 7, shipId: ship.id });

  const inputs = new Map([
    [
      7,
      {
        drill: true,
        hatch: false,
        light: false,
        shield: false,
        thrust: 0,
        turn: 0,
      },
    ],
  ]);
  const events = [];

  for (let i = 0; i < 100; i++) events.push(...updateWorld(world, inputs));

  return { asteroid, events, ship, world };
};

const first = run();
const second = run();

assert.equal(first.world.tick, 100);
assert.equal(first.world.entities.has(first.asteroid.id), false);
assert.deepEqual(
  first.events.find(({ type }) => type === 'asteroidDestroyed'),
  {
    asteroidId: first.asteroid.id,
    by: 7,
    contents: [2],
    type: 'asteroidDestroyed',
  },
);
assert.deepEqual(
  {
    events: first.events,
    ship: first.ship,
  },
  {
    events: second.events,
    ship: second.ship,
  },
);
