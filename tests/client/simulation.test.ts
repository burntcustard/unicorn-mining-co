/* global Buffer, process */

import assert from 'node:assert/strict';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'simulation',
  plugins: [
    {
      name: 'simulation-test-entry',
      load: (id) =>
        id === '\0simulation'
          ? `
import { installExampleModules } from '${process.cwd()}/tests/support/example-modules.ts';
installExampleModules();
      export { addEntity, addPlayer, createWorld, entityId } from '${process.cwd()}/src/client/simulation/world.ts';
      export { createAsteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
      export { diamond as diamondSpec } from '${process.cwd()}/src/specs/items/index.ts';
export { Item } from '${process.cwd()}/src/client/objects/item.ts';
      export { message as messageSpec } from '${process.cwd()}/src/specs/items/index.ts';
      export { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
      export { Station } from '${process.cwd()}/src/client/objects/station.ts';
      export { cloneEntity } from '${process.cwd()}/src/client/simulation/world-state.ts';
      export { updateWorld } from '${process.cwd()}/src/client/simulation/update-world.ts';
      export { detectCollisions } from '${process.cwd()}/src/client/collision/detect-collisions.ts';
      export * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
      export { roundMotion } from '${process.cwd()}/src/client/utilities/round.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'simulation' ? '\0simulation' : undefined),
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

const simulation: {
  addEntity: typeof import('../../src/client/simulation/world.ts').addEntity;
  addPlayer: typeof import('../../src/client/simulation/world.ts').addPlayer;
  createWorld: typeof import('../../src/client/simulation/world.ts').createWorld;
  entityId: typeof import('../../src/client/simulation/world.ts').entityId;
  createAsteroid: typeof import('../../src/client/objects/asteroid.ts').createAsteroid;
  diamondSpec: typeof import('../../src/specs/items/index.ts').diamond;
  Item: typeof import('../../src/client/objects/item.ts').Item;
  messageSpec: typeof import('../../src/specs/items/index.ts').message;
  createPlayerShip: typeof import('../../src/client/objects/create-ship.ts').createPlayerShip;
  Station: typeof import('../../src/client/objects/station.ts').Station;
  cloneEntity: typeof import('../../src/client/simulation/world-state.ts').cloneEntity;
  updateWorld: typeof import('../../src/client/simulation/update-world.ts').updateWorld;
  detectCollisions: typeof import('../../src/client/collision/detect-collisions.ts').detectCollisions;
  roundMotion: typeof import('../../src/client/utilities/round.ts').roundMotion;
  Vec: typeof import('../../src/client/utilities/vector.ts');
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const {
  addEntity,
  addPlayer,
  createAsteroid,
  diamondSpec,
  Item,
  messageSpec,
  createPlayerShip,
  Station,
  createWorld,
  entityId,
  cloneEntity,
  detectCollisions,
  roundMotion,
  updateWorld,
  Vec,
} = simulation;

const motionStep = 2 ** -24;

for (const [value, expected] of [
  [motionStep / 2, 0],
  [(3 * motionStep) / 2, 2 * motionStep],
  [(5 * motionStep) / 2, 2 * motionStep],
  [-motionStep / 2, -0],
  [(-3 * motionStep) / 2, -2 * motionStep],
  [-0, -0],
  [Infinity, Infinity],
  [-Infinity, -Infinity],
  [NaN, NaN],
]) {
  assert(Object.is(roundMotion(value), expected), `motion rounding ${value}`);
}

const spinWorld = createWorld({ seed: 25 });
const spinningAsteroid = addEntity(
  spinWorld,
  createAsteroid(spinWorld, { id: 900, spin: 0.04 }),
);

spinningAsteroid.update(60);
assert.equal(spinningAsteroid.spin, 671089 / 16777216);
assert.equal(spinningAsteroid.rotation, 40265318 / 16777216);

const splitWorld = createWorld({ seed: 25 });
const stillAsteroid = addEntity(
  splitWorld,
  createAsteroid(splitWorld, { id: 901, spin: 0 }),
);

const splitChildren = stillAsteroid.detach({
  asteroidSegment: stillAsteroid.segments[0],
  world: splitWorld,
});

assert(splitChildren.length > 1);
assert(
  splitChildren.some((child) => !child.segments && child.spin !== 0),
  'loose chips gain a small random spin',
);
const connectedRemainder = splitChildren.find(
  (child) => child.segments?.length > 1,
);

assert(connectedRemainder, 'the connected asteroid remainder survives');
assert.equal(
  connectedRemainder.spin,
  0,
  'the remainder inherits only parent spin',
);

const splitAgain = connectedRemainder.detach({
  asteroidSegment: connectedRemainder.segments[0],
  world: splitWorld,
});

assert(splitAgain.some((child) => !child.segments && child.spin !== 0));
assert(
  splitAgain
    .filter((child) => child.segments?.length > 1)
    .every((child) => child.spin === 0),
  'repeated splits cannot add random spin to the connected remainder',
);

const dockedMovement = () => {
  const world = createWorld({ seed: 25 });

  const station = addEntity(
    world,
    new Station({
      id: 100,
      position: Vec.create(),
      radius: 400,
      spin: 0,
    }),
  );

  const ship = addEntity(
    world,
    createPlayerShip(world, {
      playerNumber: 7,
      position: Vec.create(),
    }),
  );

  ship.dockedTo = station.id;
  addPlayer(world, { playerNumber: 7, shipId: ship.id });

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
    new Station({
      id: 100,
      position: Vec.create(),
      radius: 400,
      spin: 0,
    }),
  );

  const ship = addEntity(
    world,
    createPlayerShip(world, {
      playerNumber: 7,
      position: Vec.create(0, 400),
      velocity: Vec.create(0, -200),
    }),
  );

  // Start outside the wall: spawning inside it tests penetration recovery,
  // whose direction depends on inertia, rather than an approach to the station.
  assert.equal(detectCollisions({ entities: [station, ship] }).length, 0);
  addPlayer(world, { playerNumber: 7, shipId: ship.id });

  const events: import('../../src/client/protocol/events').SimulationEvent[] =
    [];

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

const stationExitSlowdown = () => {
  for (const rotation of [0, 0.5, 1, 1.3]) {
    const world = createWorld();
    const station = addEntity(world, new Station({ id: 100, spin: 0.1 }));

    const ship = addEntity(
      world,
      createPlayerShip(world, {
        playerNumber: 7,
        position: Vec.create(station.localMovementRadius - 1),
        rotation,
      }),
    );

    addPlayer(world, { playerNumber: 7, shipId: ship.id });
    ship.localMovementParent = station;
    ship.localMovementRate = 1;
    Vec.setXY(
      ship.velocity,
      ship.maxSpeed * Math.cos(rotation),
      ship.maxSpeed * Math.sin(rotation),
    );

    const input = {
      hornDrill: false,
      cargoHatch: false,
      launch: false,
      searchLight: false,
      shieldGenerator: false,
      thrust: 1,
      turn: 0,
    };

    const inputs = new Map([[7, input]]);

    updateWorld({ world, inputs });
    assert(!ship.localMovementParent, 'the ship leaves the station area');
    assert.equal(ship.localMovementRate, 0);

    const exitSpeed = Vec.length(ship.velocity);

    input.thrust = 0;

    for (let tick = 0; tick < 90; tick++) updateWorld({ world, inputs });

    assert.equal(ship.thrust, 0);
    assert(
      Vec.length(ship.velocity) < exitSpeed / 2,
      `the ship slows after releasing thrust outside the station at ${rotation}`,
    );
  }
};

stationExitSlowdown();

const drillDamagesOnlyAtTip = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createPlayerShip(world, { playerNumber: 7, position: Vec.create() }),
  );
  const drill = ship.hitbox().filter(({ segment }) => segment?.module.grinds);
  const body = drill.find(({ shapeOutline }) => shapeOutline);
  const tip = drill.find((collider) => ship.isDrillTip(collider));

  assert(body?.physics, 'the drill body remains a physical collider');
  assert.equal(body.friction, 0.3);
  assert.equal(tip.friction, ship.friction);
  assert.equal(ship.isDrillTip(body), false);
  assert.equal(ship.isDrillTip({ ...tip }), false);
  assert.equal(tip?.physics, false);
  assert.equal(tip?.radius, 3);
  assert(Vec.distance(tip.position, Vec.create(46)) < 1e-9);

  const check = (
    position: import('../../src/client/utilities/vector').Value,
  ) => {
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

    const events: import('../../src/client/protocol/events').SimulationEvent[] =
      [];

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
      [collider, other].some((collider) => collider === body),
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
    ({ collider, other }) => collider === tip || other === tip,
  );
  const drilled = head.events.find(({ type }) => type === 'drillDamage');

  assert(tipContact, 'the tip circle touches a rock head-on');
  assert(drilled?.type === 'drillDamage', 'a tip contact damages the asteroid');
  assert(
    head.contacts.some(
      ({ collider, other, point }) =>
        (collider === tip || other === tip) && point === drilled.position,
    ),
    'drill damage records the point of one tip contact',
  );
  assert(Vec.distance(drilled.position, body.position) > 10);
  assert.equal(tip.segment.biting, true);

  const otherShip = addEntity(
    world,
    createPlayerShip(world, { playerNumber: 8, position: Vec.create(60) }),
  );
  const craftContacts = detectCollisions({ entities: [ship, otherShip] })
    .filter(({ collider, other }) => collider === tip || other === tip)
    .sort((a, b) => b.depth - a.depth);
  const craftContact = craftContacts[0];
  const struck =
    craftContact?.collider === tip
      ? craftContact.other
      : craftContact?.collider;
  const damaged = struck?.segment?.mount || struck?.segment;
  const before = damaged?.health;
  const outline = ['#111', '#222', '#f0a'];

  struck.segment.shades = outline;

  if (!struck.segment.hull) struck.segment.module.shades = outline;

  const craftEvents: import('../../src/client/protocol/events').SimulationEvent[] =
    [];

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

  assert(craftDrilling?.type === 'drillDamage');
  assert.equal(craftDrilling?.targetId, otherShip.id);
  assert.equal(craftDrilling?.position, craftContact.point);
  assert.equal(craftDrilling?.resource, undefined);
  assert.equal(craftDrilling?.color, '#f0a');
};

drillDamagesOnlyAtTip();

const diamondPickup = () => {
  const world = createWorld({ seed: 25 });
  const ship = addEntity(
    world,
    createPlayerShip(world, { playerNumber: 7, position: Vec.create() }),
  );

  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      contents: [0],
      position: Vec.create(60),
      radius: 25,
    }),
  );

  addPlayer(world, { playerNumber: 7, shipId: ship.id });

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
      .filter((event) => event.type === 'asteroidDestroyed')
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
  Vec.set(item.velocity, Vec.create());

  const pickupInput = {
    ...drillInput,
    hornDrill: false,
    cargoHatch: true,
    thrust: 0,
  };

  const pickupEvents = [];

  // Open the hatch before bringing the item inside the hull.
  for (let i = 0; i < 60; i++) {
    pickupEvents.push(
      ...updateWorld({ world, inputs: new Map([[7, pickupInput]]) }),
    );
  }

  const throat = ship.hitbox().find(({ segment }) => segment?.catches);

  Vec.set(item.position, throat.position);

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

// The cargo contact may overlap an item's edge, but pickup waits for its center.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerNumber: 9 }));
  const throat = ship.hitbox().find(({ segment }) => segment?.catches);
  const door = ship
    .hitbox()
    .find(
      ({ segment }) =>
        segment.module === throat.segment.module && segment !== throat.segment,
    );

  const item = addEntity(
    world,
    new Item(diamondSpec, {
      world,
      id: entityId(world),
      position: Vec.add(throat.position, Vec.create(throat.radius + 2)),
    }),
  );

  const module = throat.segment.module;

  throat.segment.active = 1;

  const events: import('../../src/client/protocol/events').SimulationEvent[] =
    [];
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
    'the item center reaching the mouth collects it',
  );
}

// A slate is read at the hatch even when ordinary cargo has filled the hold.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerNumber: 9 }));
  const throat = ship.hitbox().find(({ segment }) => segment?.catches);
  const module = throat.segment.module;

  throat.segment.active = 1;
  ship.cargoContents.push(
    ...Array.from(
      { length: ship.cargoSpace },
      () => new Item(diamondSpec, { world }),
    ),
  );

  const slate = addEntity(
    world,
    new Item(messageSpec, {
      world,
      id: entityId(world),
      message: 'GOLD ORE 100/200',
      position: Vec.clone(throat.position),
    }),
  );

  const events: import('../../src/client/protocol/events').SimulationEvent[] =
    [];

  module.collect({
    ship,
    contact: { collider: throat, other: slate.hitbox()[1] },
    events,
    world,
  });

  assert.equal(ship.cargoContents.length, ship.cargoSpace);
  assert.equal(world.entities.has(slate.id), false);

  assert.deepEqual(events[0], {
    by: 9,
    itemId: slate.id,
    message: 'GOLD ORE 100/200',
    resource: 4,
    type: 'itemCollected',
    unlock: undefined,
  });
}

// Shared 60/30/15 Hz tiers conserve elapsed time on both client and server.
// Visible stationary asteroids only spin, so they move once per tick.
for (const multiplayer of [false, true]) {
  const world = createWorld();
  const pilot = addEntity(
    world,
    createPlayerShip(world, { playerNumber: 1, position: Vec.create() }),
  );
  const remote = addEntity(
    world,
    createPlayerShip(world, { playerNumber: 2, position: Vec.create(10000) }),
  );

  addPlayer(world, { playerNumber: 1, shipId: pilot.id });

  if (multiplayer) addPlayer(world, { playerNumber: 2, shipId: remote.id });
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

  const calls: number[][] = bodies.map(() => [] as number[]);

  bodies.forEach((body, index) => {
    body.update = (dt) => calls[index].push(dt);
  });

  for (let tick = 0; tick < 30; tick++) {
    updateWorld({ world: world, inputs: new Map() });
  }

  assert.deepEqual(
    calls.map((steps) => steps.length),
    [30, 30, 15, multiplayer ? 30 : 15],
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
    Math.abs(calls[2].at(-1) - 4 / 60) < 1e-12,
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

// A timed launch must snap to either bay without turning that pose change into spin.
for (const rotation of [-2, 0, 0.7]) {
  for (const angle of [0, Math.PI]) {
    const launchWorld = createWorld({ seed: 25 });

    const station = addEntity(
      launchWorld,
      new Station({
        world: launchWorld,
        stationType: 'corral-6',
        rotation,
        spin: 0.05,
      }),
    );

    station.dockingBays = [angle];
    const ship = addEntity(
      launchWorld,
      createPlayerShip(launchWorld, { playerNumber: 7 }),
    );

    addPlayer(launchWorld, { playerNumber: 7, shipId: ship.id });
    ship.dockedTo = station.id;

    updateWorld({
      world: launchWorld,
      inputs: new Map([
        [
          7,
          {
            input: emptyPlayerInput(),
            changes: [
              {
                offset: 1 / 60,
                input: { ...emptyPlayerInput(), launch: true },
              },
            ],
          },
        ],
      ]),
    });

    assert(Math.abs(ship.spin) < 0.1, 'instant facing must not become spin');
    const direction = station.rotation + angle;

    assert(Math.abs(Math.sin(ship.rotation - direction)) < 0.001);
    assert(Math.cos(ship.rotation - direction) > 0.99);

    for (let tick = 0; tick < 150; tick++) {
      updateWorld({
        world: launchWorld,
        inputs: new Map([[7, { ...emptyPlayerInput(), thrust: 1 }]]),
      });
    }

    assert(
      Vec.distance(ship.position, station.position) >
        station.localMovementRadius,
      'ship leaves through the selected bay',
    );
    assert(Math.abs(ship.spin) < 0.1);
  }
}

// Docking preserves the arrival angle and turns off every fitted module immediately.
const arrivalWorld = createWorld();
const arrivalStation = addEntity(
  arrivalWorld,
  new Station({ world: arrivalWorld }),
);
const arrivalShip = addEntity(
  arrivalWorld,
  createPlayerShip(arrivalWorld, { position: Vec.create(150), rotation: 0.4 }),
);

arrivalShip.segments.forEach((segment) => {
  segment.active = 1;
});

updateWorld({ world: arrivalWorld, inputs: new Map() });
assert.equal(arrivalShip.dockedTo, arrivalStation.id);
assert(Math.abs(arrivalShip.rotation - 0.4) < 1e-6);
assert(arrivalShip.segments.every((segment) => segment.active === 0));
updateWorld({ world: arrivalWorld, inputs: new Map() });
assert(
  Math.abs(arrivalShip.rotation - 0.4) < 1e-6,
  'docked updates must not reset the arrival angle',
);
