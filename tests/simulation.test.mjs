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
      export { detectCollisions } from '${process.cwd()}/src/shared/collision/detect-collisions.ts';
      export { Vector } from '${process.cwd()}/src/shared/vector.ts';
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
  createItem,
  createShip,
  createStation,
  createWorld,
  cloneEntity,
  detectCollisions,
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
  updateWorld({
    world: world,
    inputs: new Map([
      [
        7,
        {
          hornDrill: false,
          cargoHatch: false,
          launch: false,
          searchLight: false,
          shieldGenerator: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  });
  assert(Number.isFinite(ship.position.x));
  assert(Number.isFinite(ship.position.y));

  updateWorld({
    world: world,
    inputs: new Map([
      [
        7,
        {
          hornDrill: false,
          cargoHatch: false,
          launch: true,
          searchLight: false,
          shieldGenerator: false,
          thrust: 1,
          turn: 0,
        },
      ],
    ]),
  });
  const position = ship.position.x;

  updateWorld({
    world: world,
    inputs: new Map([
      [
        7,
        {
          hornDrill: false,
          cargoHatch: false,
          launch: false,
          searchLight: false,
          shieldGenerator: false,
          thrust: 1,
          turn: 0,
        },
      ],
    ]),
  });
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
    createShip(world, {
      playerId: 7,
      position: Vector(0, 400),
      velocity: Vector(0, -200),
    }),
  );

  // Start outside the wall: spawning inside it tests penetration recovery,
  // whose direction depends on inertia, rather than an approach to the station.
  assert.equal(detectCollisions({ entities: [station, ship] }).length, 0);
  addPlayer(world, { id: 7, shipId: ship.id });
  const events = [];

  for (let tick = 0; tick < 90; tick++) {
    events.push(
      ...updateWorld({
        world: world,
        inputs: new Map([
          [
            7,
            {
              hornDrill: false,
              cargoHatch: false,
              launch: false,
              searchLight: false,
              shieldGenerator: false,
              thrust: 0,
              turn: 0,
            },
          ],
        ]),
      }),
    );
  }
  assert(
    events.some(({ type }) => type === 'collision'),
    'the approaching ship hits the station wall',
  );
  assert.equal(ship.dockedTo, undefined);
  assert.equal(station.kind, 'station');
};

dockingShape();
dockedMovement();

const compoundShipGeometry = () => {
  const world = createWorld();
  const first = createShip(world, { position: Vector() });
  const separated = createShip(world, { position: Vector(0, 75) });

  // Their 40-unit bounding circles overlap, but their real hulls do not.
  assert.equal(
    detectCollisions({ entities: [first, separated] }).some(
      ({ collider, other }) =>
        collider.physics !== false && other.physics !== false,
    ),
    false,
  );
  separated.position.y = 60;
  assert.equal(
    detectCollisions({ entities: [first, separated] }).some(
      ({ collider, other }) =>
        collider.physics !== false && other.physics !== false,
    ),
    true,
  );
};

const stationGeometry = () => {
  const world = createWorld();
  const station = createStation({ id: 100, position: Vector(), radius: 400 });
  const bayShip = createShip(world, { position: Vector(210) });
  const wallShip = createShip(world, { position: Vector(0, 250) });

  assert.equal(
    detectCollisions({ entities: [station, bayShip] }).filter(
      ({ collider, other }) =>
        collider.physics !== false && other.physics !== false,
    ).length,
    0,
  );
  assert.equal(
    detectCollisions({ entities: [station, wallShip] }).some(
      ({ collider, other }) =>
        collider.physics !== false && other.physics !== false,
    ),
    true,
  );

  const dockingWorld = createWorld();
  const dockingStation = addEntity(
    dockingWorld,
    createStation({ id: 200, position: Vector(), radius: 400 }),
  );
  const dockingShip = addEntity(
    dockingWorld,
    createShip(dockingWorld, { playerId: 8, position: Vector(150) }),
  );

  addPlayer(dockingWorld, { id: 8, shipId: dockingShip.id });
  updateWorld({ world: dockingWorld, inputs: new Map() });
  assert.equal(dockingShip.dockedTo, dockingStation.id);
};

compoundShipGeometry();
stationGeometry();

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
    hornDrill: false,
    cargoHatch: false,
    launch: false,
    searchLight: false,
    shieldGenerator: false,
    thrust: 1,
    turn: 0,
  };
  let events = [];

  for (let i = 0; i < 120; i++) {
    events = updateWorld({ world: world, inputs: new Map([[7, input]]) });

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
  updateWorld({
    world: world,
    inputs: new Map([
      [
        7,
        {
          hornDrill: true,
          cargoHatch: false,
          launch: false,
          searchLight: false,
          shieldGenerator: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  });
  assert(ship.velocity.x >= 0);
};

drillingDoesNotBounce();

const drillSelectsTouchedSegment = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      position: Vector(55),
      radius: 25,
      contents: [0, 1, 2],
    }),
  );
  const before = asteroid.segments.map(({ health }) => health);

  ship.segments
    .filter((segment) => segment.module.grinds)
    .forEach((segment) => (segment.activationProgress = 1));

  addPlayer(world, { id: 7, shipId: ship.id });
  updateWorld({
    world: world,
    inputs: new Map([
      [
        7,
        {
          hornDrill: true,
          cargoHatch: false,
          launch: false,
          searchLight: false,
          shieldGenerator: false,
          thrust: 0,
          turn: 0,
        },
      ],
    ]),
  });
  assert.equal(
    asteroid.segments.filter(({ health }, index) => health < before[index])
      .length,
    1,
  );
  assert(
    world.entities.has(asteroid.id),
    'a healthy asteroid segment keeps the parent intact',
  );
  assert(
    ![...world.entities.values()].some((entity) => entity.kind === 'item'),
    'the parent does not release its contents at its centre',
  );
  // Whole-body destruction remains valid, even with healthy segments remaining.
  asteroid.health = 0;
  const events = [];

  assert(
    asteroid.fracture({
      asteroidSegment: asteroid.segments[0],
      by: 7,
      events,
      world,
    }),
  );
  assert(!world.entities.has(asteroid.id));
  assert.deepEqual(
    [...world.entities.values()]
      .filter((entity) => entity.kind === 'item')
      .map((item) => item.resource)
      .sort((a, b) => a - b),
    [0, 1, 2],
  );
  assert.equal(events[0].type, 'asteroidDestroyed');
  assert.equal(
    asteroid.fracture({ by: 7, events, world }),
    false,
    'stale contacts cannot release the contents twice',
  );
};

drillSelectsTouchedSegment();

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
    hornDrill: true,
    cargoHatch: false,
    launch: false,
    searchLight: false,
    shieldGenerator: false,
    thrust: 0,
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
    const target = [...world.entities.values()].find(
      (entity) => entity.kind === 'asteroid' && entity.contents.length,
    );

    // A pilot has to keep aiming as pieces move after a split. Keep the horn drill
    // tip on the resource-bearing child so this covers split -> child -> item.
    if (target) {
      ship.rotation = 0;
      ship.spin = 0;
      ship.position.set(target.position.subtract(Vector(47)));
      ship.velocity.set(Vector());
    }
    miningEvents.push(
      ...updateWorld({ world: world, inputs: new Map([[7, drillInput]]) }),
    );
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
    miningEvents
      .filter(({ type }) => type === 'asteroidDestroyed')
      .flatMap(({ contents }) => contents),
    [0],
  );
  const item = [...world.entities.values()].find(({ kind }) => kind === 'item');

  assert.equal(item?.resource, 0);
  ship.rotation = 0;
  ship.spin = 0;
  ship.velocity.set(Vector());
  item.position.set(ship.position.add(Vector(3, -13)));
  item.velocity.set(Vector());

  const pickupInput = {
    ...drillInput,
    hornDrill: false,
    cargoHatch: true,
    thrust: 0,
  };
  const pickupEvents = [];

  for (let i = 0; i < 120 && !ship.cargoContents?.length; i++) {
    pickupEvents.push(
      ...updateWorld({ world: world, inputs: new Map([[7, pickupInput]]) }),
    );
  }

  assert.deepEqual(
    ship.cargoContents.map((item) => item.resource),
    [0],
  );
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

// The cargo contact may overlap an item's edge, but pickup waits for its centre.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 9 }));
  const throat = ship.hitbox().find(({ role }) => role === 'cargoHatch');
  const door = ship
    .hitbox()
    .find(
      ({ segment }) =>
        segment.module === throat.segment.module && segment !== throat.segment,
    );
  const item = addEntity(
    world,
    createItem(world, {
      resource: 0,
      position: throat.position.add(Vector(throat.radius + 2)),
    }),
  );
  const module = throat.segment.module;

  throat.segment.active = 1;
  const events = [];
  const [cargoBody, cargoPoint] = item.hitbox();

  module.collect({
    ship,
    contact: { collider: door, other: cargoPoint },
    events,
    world,
  });
  module.collect({
    ship,
    contact: { collider: throat, other: cargoBody },
    events,
    world,
  });
  assert.equal(
    ship.cargoContents.length,
    0,
    'door contact or edge overlap cannot collect cargo',
  );
  item.position.set(throat.position);
  module.collect({
    ship,
    contact: { collider: throat, other: cargoPoint },
    events,
    world,
  });
  assert.equal(
    ship.cargoContents[0],
    item,
    'the item centre reaching the mouth collects it',
  );
}

const starAsteroidLosesOneArm = () => {
  const world = createWorld({ seed: 25 });
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      pointCount: 6,
      position: Vector(60),
      radius: 25,
      radiusEven: 12,
    }),
  );

  asteroid.detach({ asteroidSegment: asteroid.segments[1], world });
  const pieces = [...world.entities.values()].filter(
    ({ kind }) => kind === 'asteroid',
  );
  const arm = pieces.find(({ decay }) => decay);
  const remainder = pieces.find(({ segments }) => segments?.length);

  assert.equal(world.entities.has(asteroid.id), false);
  assert.equal(arm.outline.length, 3);
  assert.equal(remainder.segments.length, 3);
};

starAsteroidLosesOneArm();

const splitConservesOriginalGeometry = () => {
  const area = (outline) =>
    Math.abs(
      outline.reduce((sum, [x, y], index) => {
        const next = outline[(index + 1) % outline.length];

        return sum + x * next[1] - next[0] * y;
      }, 0),
    ) / 2;

  for (const star of [true, false]) {
    const world = createWorld({ seed: 25 });
    const rock = addEntity(
      world,
      createAsteroid(world, {
        radius: 100,
        pointCount: star ? 6 : 7,
        radiusEven: star ? 25 : undefined,
        resource: 1,
        contents: [1, 1, 1],
        rotation: 0.4,
        position: Vector(200, 300),
      }),
    );
    const originalArea = rock.segments.reduce(
      (sum, asteroidSegment) => sum + area(asteroidSegment.outline),
      0,
    );
    const originalMass = rock.mass;
    const leaves = rock.segments.length;

    for (let split = 0; split < leaves; split++) {
      const parent = [...world.entities.values()].find(
        (object) => object.segments?.length,
      );

      if (!parent) break;
      const asteroidSegment = parent.segments.reduce((outer, next) =>
        Math.max(...outer.outline.map(([x]) => x)) >
        Math.max(...next.outline.map(([x]) => x))
          ? outer
          : next,
      );

      parent.detach({ asteroidSegment, world });
      const children = [...world.entities.values()];

      assert(parent.dead);
      assert(children.every((child) => child.resource === 1));
      assert.equal(
        children.reduce((sum, child) => sum + child.contents.length, 0),
        3,
      );
      assert(
        Math.abs(
          children.reduce((sum, child) => sum + child.mass, 0) - originalMass,
        ) < 1e-8,
      );
      assert(
        Math.abs(
          children.reduce((sum, child) => sum + area(child.outline), 0) -
            originalArea,
        ) < 1e-8,
        'repeated splits neither duplicate nor lose rock',
      );
    }
    assert.equal(
      world.entities.size,
      leaves,
      'original star faces and ordinary quarter-faces remain the final leaves',
    );
  }
};

splitConservesOriginalGeometry();

const authoritativeSnapshotReplacesPredictedSplit = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vector() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      pointCount: 6,
      position: Vector(60),
      radius: 25,
      radiusEven: 12,
    }),
  );
  const authoritative = [ship, asteroid].map((entity) =>
    cloneEntity({ entity }),
  );
  const prediction = new PredictionManager({ world });

  ship.segments
    .filter((segment) => segment.module.grinds)
    .forEach((segment) => (segment.activationProgress = 1));

  asteroid.segments.forEach(
    (asteroidSegment) => (asteroidSegment.health = 0.5),
  );
  authoritative
    .find(({ kind }) => kind === 'asteroid')
    .segments.forEach((asteroidSegment) => (asteroidSegment.health = 0.5));
  addPlayer(world, { id: 7, shipId: ship.id });
  prediction.setLocalPlayer({ playerId: 7 });
  prediction.step({
    input: {
      hornDrill: true,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
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
  prediction.reconcile({ entities: authoritative, tick: 0 });
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
        hornDrill: true,
        cargoHatch: false,
        searchLight: false,
        shieldGenerator: false,
        thrust: 0,
        turn: 0,
      },
    ],
  ]);
  const events = [];

  ship.segments
    .filter((segment) => segment.module.grinds)
    .forEach((segment) => (segment.activationProgress = 1));

  for (let i = 0; i < 100; i++) {
    events.push(...updateWorld({ world: world, inputs: inputs }));
  }

  return { asteroid, events, ship, world };
};

const first = run();
const second = run();

// Shared 60/15 Hz tiers conserve elapsed time on both client and server.
for (const multiplayer of [false, true]) {
  const world = createWorld();
  const pilot = addEntity(
    world,
    createShip(world, { playerId: 1, position: Vector() }),
  );
  const remote = addEntity(
    world,
    createShip(world, { playerId: 2, position: Vector(10000) }),
  );

  addPlayer(world, { id: 1, shipId: pilot.id });

  if (multiplayer) addPlayer(world, { id: 2, shipId: remote.id });
  const bodies = [Vector(150), Vector(1000), Vector(5000), Vector(10150)].map(
    (position) =>
      addEntity(
        world,
        createAsteroid(world, { position, radius: 10, pointCount: 3 }),
      ),
  );
  const calls = bodies.map(() => []);

  bodies.forEach((body, index) => {
    body.update = (dt) => calls[index].push(dt);
  });

  for (let tick = 0; tick < 30; tick++) {
    updateWorld({ world: world, inputs: new Map() });
  }
  assert.deepEqual(
    calls.map((steps) => steps.length),
    [60, 60, 15, multiplayer ? 60 : 15],
  );
  calls.forEach((steps) =>
    assert(Math.abs(steps.reduce((total, dt) => total + dt, 0) - 1) < 1e-12),
  );
  updateWorld({ world: world, inputs: new Map() });
  assert.equal(bodies[2].pendingUpdateTime, 2 / 60);
  const saved = cloneEntity({ entity: bodies[2] });

  bodies[2].position.set(Vector(1000));
  updateWorld({ world: world, inputs: new Map() });
  assert(
    Math.abs(calls[2].at(-1) - 2 / 60) < 1e-12,
    'tier promotion consumes accumulated time once',
  );
  assert.equal(bodies[2].pendingUpdateTime, 0);
  assert.equal(
    saved.pendingUpdateTime,
    2 / 60,
    'rollback retains scheduler phase',
  );
}

// Movement-parent discovery is shared by a substep, not repeated/allocated for
// each asteroid, item and ship in the region.
const movementWorld = createWorld();

for (let i = 0; i < 50; i++) {
  addEntity(
    movementWorld,
    createAsteroid(movementWorld, {
      position: Vector(i * 1000, 10000),
      radius: 10,
      pointCount: 3,
    }),
  );
}
const values = movementWorld.entities.values.bind(movementWorld.entities);
let entityScans = 0;

movementWorld.entities.values = () => {
  entityScans++;
  return values();
};
updateWorld({ world: movementWorld, inputs: new Map() });
assert(
  entityScans <= 4,
  'movement does not allocate an entity array per object',
);
assert.equal(
  movementWorld.movementParents,
  undefined,
  'temporary movement cache cannot survive a tick or rollback',
);

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
    ship: {
      position: first.ship.position,
      velocity: first.ship.velocity,
      rotation: first.ship.rotation,
      spin: first.ship.spin,
      hullHealth: first.ship.hullHealth,
      modules: first.ship.moduleStates,
    },
  },
  {
    events: second.events,
    ship: {
      position: second.ship.position,
      velocity: second.ship.velocity,
      rotation: second.ship.rotation,
      spin: second.ship.spin,
      hullHealth: second.ship.hullHealth,
      modules: second.ship.moduleStates,
    },
  },
);
