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
      export { addEntity, addPlayer, createWorld, entityId } from '${process.cwd()}/src/shared/simulation/world.ts';
      export { createAsteroid, shapeOutlinesFrom } from '${process.cwd()}/src/shared/simulation/asteroid.ts';
      export { Diamond } from '${process.cwd()}/src/shared/items/diamond.ts';
      export { createShip } from '${process.cwd()}/src/shared/craft/create-ship.ts';
      export { createStation } from '${process.cwd()}/src/shared/craft/create-station.ts';
      export { cloneEntity } from '${process.cwd()}/src/shared/simulation/world-state.ts';
      export { updateWorld } from '${process.cwd()}/src/shared/simulation/update-world.ts';
      export { detectCollisions } from '${process.cwd()}/src/shared/collision/detect-collisions.ts';
      export * as Vec from '${process.cwd()}/src/shared/vector.ts';
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
  Diamond,
  createShip,
  createStation,
  createWorld,
  entityId,
  cloneEntity,
  detectCollisions,
  shapeOutlinesFrom,
  PredictionManager,
  updateWorld,
  Vec,
} = simulation;

const dockedMovement = () => {
  const world = createWorld({ seed: 25 });
  const station = addEntity(
    world,
    createStation({
      id: 100,
      position: Vec.create(),
      radius: 400,
      spin: 0,
    }),
  );
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 7,
      position: Vec.create(),
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
      position: Vec.create(),
      radius: 400,
      spin: 0,
    }),
  );
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 7,
      position: Vec.create(0, 400),
      velocity: Vec.create(0, -200),
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
  const first = createShip(world, { position: Vec.create() });
  const separated = createShip(world, { position: Vec.create(0, 75) });

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
  const station = createStation({
    id: 100,
    position: Vec.create(),
    radius: 400,
  });
  const bayShip = createShip(world, { position: Vec.create(210) });
  const wallShip = createShip(world, { position: Vec.create(0, 250) });

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
    createStation({ id: 200, position: Vec.create(), radius: 400 }),
  );
  const dockingShip = addEntity(
    dockingWorld,
    createShip(dockingWorld, { playerId: 8, position: Vec.create(150) }),
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
    createShip(world, { playerId: 7, position: Vec.create() }),
  );

  addEntity(
    world,
    createAsteroid(world, { position: Vec.create(200), radius: 25 }),
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
  assert(Vec.length(ship.velocity) > 0);
  assert(events.some(({ type }) => type === 'collision'));
};

collisionAndThrust();

const drillingDoesNotBounce = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 7,
      position: Vec.create(),
      velocity: Vec.create(10),
    }),
  );

  addEntity(
    world,
    createAsteroid(world, { position: Vec.create(50), radius: 25 }),
  );
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

const drillDamagesOnlyAtTip = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const drill = ship.hitbox().filter(({ segment }) => segment?.module.grinds);
  const body = drill.find(({ shapeOutline }) => shapeOutline);
  const tip = drill.find(({ role }) => role === 'hornDrill');

  assert(body?.physics, 'the drill body remains a physical collider');
  assert.equal(body.friction, 0.3);
  assert.equal(tip.friction, ship.friction);
  assert.equal(body.role, undefined);
  assert.equal(tip?.physics, false);
  assert.equal(tip?.radius, 3);
  assert(Vec.distance(tip.position, Vec.create(46)) < 1e-9);

  const check = (position) => {
    const asteroid = addEntity(
      world,
      createAsteroid(world, {
        position,
        radius: 5,
        radiusEven: 5,
        pointCount: 6,
      }),
    );
    const contacts = detectCollisions({ entities: [ship, asteroid] });
    const events = [];

    ship.segments
      .filter((segment) => segment.module.grinds)
      .forEach((segment) => (segment.activationProgress = 1));
    ship.handleContacts({ contacts, events, world, dt: 1 / 60 });
    asteroid.remove();
    return { contacts, events };
  };

  const flank = check(Vec.create(35, 7));

  assert(
    flank.contacts.some(({ collider, other }) =>
      [collider, other].some(
        ({ segment, role }) => segment === body.segment && role !== 'hornDrill',
      ),
    ),
    'the drill body still touches a rock on its flank',
  );
  assert.equal(
    flank.events.some(({ type }) => type === 'drillDamage'),
    false,
    'a flank contact cannot drill',
  );
  assert.equal(Boolean(tip.segment.biting), false);

  const head = check(Vec.create(50));

  const tipContact = head.contacts.find(
    ({ collider, other }) =>
      collider.role === 'hornDrill' || other.role === 'hornDrill',
  );
  const drilled = head.events.find(({ type }) => type === 'drillDamage');

  assert(tipContact, 'the tip circle touches a rock head-on');
  assert(drilled, 'a tip contact damages the asteroid');
  assert(
    head.contacts.some(
      ({ collider, other, point }) =>
        (collider.role === 'hornDrill' || other.role === 'hornDrill') &&
        point === drilled.position,
    ),
    'drill damage records the point of one tip contact',
  );
  assert(Vec.distance(drilled.position, body.position) > 10);
  assert.equal(tip.segment.biting, true);

  const otherShip = addEntity(
    world,
    createShip(world, { playerId: 8, position: Vec.create(60) }),
  );
  const craftContacts = detectCollisions({ entities: [ship, otherShip] })
    .filter(
      ({ collider, other }) =>
        collider.role === 'hornDrill' || other.role === 'hornDrill',
    )
    .sort((a, b) => b.depth - a.depth);
  const craftContact = craftContacts[0];
  const struck =
    craftContact?.collider.role === 'hornDrill'
      ? craftContact.other
      : craftContact?.collider;
  const damaged = struck?.segment?.mount || struck?.segment;
  const before = damaged?.health;
  const craftEvents = [];

  assert.equal(struck?.owner, otherShip, 'the drill tip touches another ship');
  ship.handleContacts({
    contacts: craftContacts,
    events: craftEvents,
    world,
    dt: 1 / 60,
  });

  assert(
    damaged.health < before,
    'the drill damages the contacted craft segment',
  );
  const craftDrilling = craftEvents.find(({ type }) => type === 'drillDamage');

  assert.equal(craftDrilling?.targetId, otherShip.id);
  assert.equal(craftDrilling?.position, craftContact.point);
  assert.equal(craftDrilling?.resource, undefined);
};

drillDamagesOnlyAtTip();

// The physical drill surface still lets a moving ship slide along a rock while
// the tip keeps drilling; the existing velocity adjustment retains inward pull.
{
  const world = createWorld({ seed: 25 });
  const ship = addEntity(world, createShip(world, { playerId: 7 }));

  addEntity(
    world,
    createAsteroid(world, {
      position: Vec.create(55),
      radius: 25,
      pointCount: 6,
    }),
  );
  addPlayer(world, { id: 7, shipId: ship.id });
  ship.segments
    .filter((segment) => segment.module.grinds)
    .forEach((segment) => {
      segment.active = 1;
      segment.activationProgress = 1;
    });
  Vec.set(ship.velocity, Vec.create(0, 100));
  let damageContacts = 0;

  for (let tick = 0; tick < 5; tick++) {
    damageContacts += updateWorld({
      world,
      inputs: new Map([
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
      ]),
    }).filter(({ type }) => type === 'drillDamage').length;
  }
  assert.equal(damageContacts, 5);
  assert(ship.position.y > 4, 'the drill slides tangentially across the rock');
  assert(ship.velocity.x > 0, 'drilling retains inward velocity adjustment');
}

const drillDamagesCraftInWorld = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const otherShip = addEntity(
    world,
    createShip(world, { playerId: 8, position: Vec.create(60) }),
  );

  addPlayer(world, { id: 7, shipId: ship.id });
  ship.segments
    .filter((segment) => segment.module.grinds)
    .forEach((segment) => {
      segment.active = 1;
      segment.activationProgress = 1;
    });
  const events = updateWorld({
    world,
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

  assert(
    events.some(
      ({ type, targetId }) =>
        type === 'drillDamage' && targetId === otherShip.id,
    ),
    'the physics world delivers a drill-tip contact against another ship',
  );
};

drillDamagesCraftInWorld();

const drillSelectsTouchedSegment = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      position: Vec.create(55),
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
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      contents: [0],
      position: Vec.create(60),
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
  const drillingEvents = [];
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
      Vec.set(ship.position, Vec.subtract(target.position, Vec.create(47)));
      Vec.set(ship.velocity, Vec.create());
    }
    drillingEvents.push(
      ...updateWorld({ world: world, inputs: new Map([[7, drillInput]]) }),
    );
    fracturedChunk ||= [...world.entities.values()].find(
      (entity) =>
        entity.kind === 'asteroid' && entity.id !== asteroid.id && entity.decay,
    );
  }

  assert.equal(world.entities.has(asteroid.id), false);
  assert(fracturedChunk?.shapeOutline?.length >= 3);
  assert.equal(
    drillingEvents.some(({ type }) => type === 'drillDamage'),
    true,
  );
  assert.deepEqual(
    drillingEvents
      .filter(({ type }) => type === 'asteroidDestroyed')
      .flatMap(({ contents }) => contents),
    [0],
  );
  const item = [...world.entities.values()].find(({ kind }) => kind === 'item');

  assert.equal(item?.resource, 0);
  ship.rotation = 0;
  ship.spin = 0;
  // Collect clear of the asteroid fragments left by the drilling stage.
  Vec.set(ship.position, Vec.create(-200));
  Vec.set(ship.velocity, Vec.create());
  Vec.set(item.position, Vec.add(ship.position, Vec.create(3, -13)));
  Vec.set(item.velocity, Vec.create());

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
    new Diamond({
      world,
      id: entityId(world),
      position: Vec.add(throat.position, Vec.create(throat.radius + 2)),
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
  Vec.set(item.position, throat.position);
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
      position: Vec.create(60),
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
  assert.equal(arm.shapeOutline.length, 3);
  assert.equal(remainder.segments.length, 3);
};

starAsteroidLosesOneArm();

const splitConservesOriginalGeometry = () => {
  const area = (shapeOutline) =>
    Math.abs(
      shapeOutline.reduce((sum, [x, y], index) => {
        const next = shapeOutline[(index + 1) % shapeOutline.length];

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
        position: Vec.create(200, 300),
      }),
    );
    const originalArea = rock.segments.reduce(
      (sum, asteroidSegment) => sum + area(asteroidSegment.shapeOutline),
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
        Math.max(...outer.shapeOutline.map(([x]) => x)) >
        Math.max(...next.shapeOutline.map(([x]) => x))
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
          children.reduce((sum, child) => sum + area(child.shapeOutline), 0) -
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

const interiorSplitRetainsHole = () => {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 7 }));
  const rock = addEntity(
    world,
    createAsteroid(world, { radius: 150, pointCount: 7 }),
  );
  const broken = rock.segments[0];
  const drill = ship.segments.find((segment) => segment.module.grinds);
  const events = [];

  broken.health = 0.5;
  drill.activationProgress = 1;
  ship.handleContacts({
    contacts: [
      {
        collider: { owner: ship, role: 'hornDrill', segment: drill },
        other: { owner: rock, asteroidSegment: broken },
        point: ship.position,
        depth: 1,
      },
    ],
    events,
    world,
    dt: 1 / 30,
  });
  const children = [...world.entities.values()].filter(
    (entity) => entity.kind === 'asteroid',
  );
  const remainder = children.find((child) => child.segments?.length);

  assert.equal(events.filter(({ type }) => type === 'asteroidSplit').length, 1);
  assert.equal(
    children.length,
    2,
    'drilling one inner segment creates two children',
  );
  const rings = shapeOutlinesFrom(remainder.segments);
  const area = (shapeOutline) =>
    Math.abs(
      shapeOutline.reduce((sum, [x, y], index) => {
        const next = shapeOutline[(index + 1) % shapeOutline.length];

        return sum + x * next[1] - next[0] * y;
      }, 0),
    ) / 2;

  assert.equal(rings.length, 2, 'an interior break leaves a real hole');
  const ringAreas = rings.map(area).sort((a, b) => b - a);

  assert(
    Math.abs(
      ringAreas[0] -
        ringAreas[1] -
        remainder.segments.reduce(
          (sum, segment) => sum + area(segment.shapeOutline),
          0,
        ),
    ) < 1e-8,
    'the remaining visible boundary excludes the detached piece',
  );

  for (const seed of [5, 6]) {
    const world = createWorld({ seed });

    addEntity(world, createAsteroid(world, { radius: 150, pointCount: 7 }));

    for (let step = 0; step < 10; step++) {
      const parents = [...world.entities.values()].filter(
        (entity) => entity.segments?.length,
      );
      const parent = parents[(seed + step) % parents.length];
      const segment =
        parent.segments[(seed * 3 + step * 5) % parent.segments.length];

      parent.detach({ asteroidSegment: segment, world });
      world.entities.forEach((child) => {
        if (!child.segments) return;
        const areas = shapeOutlinesFrom(child.segments)
          .map(area)
          .sort((a, b) => b - a);
        const visible =
          areas[0] - areas.slice(1).reduce((sum, hole) => sum + hole, 0);
        const actual = child.segments.reduce(
          (sum, piece) => sum + area(piece.shapeOutline),
          0,
        );

        assert(
          Math.abs(visible - actual) < 1e-8,
          'repeated interior splits preserve all holes and visible area',
        );
      });
    }
  }
};

interiorSplitRetainsHole();

const authoritativeSnapshotReplacesPredictedSplit = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      pointCount: 6,
      position: Vec.create(60),
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
    createShip(world, { playerId: 7, position: Vec.create() }),
  );
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      contents: [2],
      shapeOutline: [
        [25, 0],
        [-25, 25],
        [-25, -25],
      ],
      position: Vec.create(70),
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
    createShip(world, { playerId: 1, position: Vec.create() }),
  );
  const remote = addEntity(
    world,
    createShip(world, { playerId: 2, position: Vec.create(10000) }),
  );

  addPlayer(world, { id: 1, shipId: pilot.id });

  if (multiplayer) addPlayer(world, { id: 2, shipId: remote.id });
  const bodies = [
    Vec.create(150),
    Vec.create(1000),
    Vec.create(5000),
    Vec.create(10150),
  ].map((position) =>
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

  Vec.set(bodies[2].position, Vec.create(1000));
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
      position: Vec.create(i * 1000, 10000),
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
