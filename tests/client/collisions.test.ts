/* global Buffer, process */

import '../support/audio-context.ts';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

Object.assign(globalThis, { canvas: { getContext: () => ({}) } });
Object.assign(globalThis, { location: { search: '' } });

Object.assign(globalThis, {
  Path2D: class {
    arc() {}

    closePath() {}

    lineTo() {}

    moveTo() {}
  },
});

const bundle = await rolldown({
  input: 'physics',
  plugins: [
    {
      name: 'physics-test-entry',
      load: (id) =>
        id === '\0physics'
          ? `
      export { detectCollisions } from '${process.cwd()}/src/client/collision/detect-collisions.ts';
      export { contactBetween } from '${process.cwd()}/src/client/collision/contact-between.ts';
      export { outerEdges } from '${process.cwd()}/src/client/utilities/polygon.ts';
      export { GameCollisions } from '${process.cwd()}/src/client/collision/game-collisions.ts';
      export { GameObject } from '${process.cwd()}/src/client/objects/game-object.ts';
      export { Module } from '${process.cwd()}/src/client/objects/modules/module.ts';
      export { addEntity, addPlayer, createWorld, entityId } from '${process.cwd()}/src/client/simulation/world.ts';
      export { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
      export { diamond as diamondDefinition } from '${process.cwd()}/src/definitions/items/index.ts';
export { Item } from '${process.cwd()}/src/client/objects/item.ts';
      export { createAsteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
      export { updateWorld } from '${process.cwd()}/src/client/simulation/update-world.ts';
      export { captureWorld, restoreWorld } from '${process.cwd()}/src/client/simulation/world-state.ts';
      export { controlShip } from '${process.cwd()}/src/client/objects/control-ship.ts';
      export { simulationStep } from '${process.cwd()}/src/definitions/simulation.ts';
      export { sparks, sprayDamage } from '${process.cwd()}/src/client/effects/shrapnel.ts';
      export { damage } from '${process.cwd()}/src/client/objects/damage.ts';
      export * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
      export { computeDistance, DistanceInput, DistanceOutput, SimplexCache } from '${process.cwd()}/src/client/collision/shape-distance.ts';
      export * as matrix from '${process.cwd()}/src/client/utilities/vector-math.ts';
      export { SpatialGrid } from '${process.cwd()}/src/client/collision/spatial-grid.ts';
      export { AABB } from '${process.cwd()}/src/client/collision/axis-aligned-bounds.ts';
      export { World as PhysicsWorld } from '${process.cwd()}/src/client/physics/world.ts';
      export { CircleShape } from '${process.cwd()}/src/client/collision/shape/circle-shape.ts';
      export { PolygonShape } from '${process.cwd()}/src/client/collision/shape/polygon-shape.ts';
      export { ShieldGenerator } from '${process.cwd()}/src/client/objects/modules/shield-generator.ts';
      export { movePoint, rotatePoint } from '${process.cwd()}/src/client/utilities/geometry.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'physics' ? '\0physics' : undefined),
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

const physics: {
  detectCollisions: typeof import('../../src/client/collision/detect-collisions.ts').detectCollisions;
  contactBetween: typeof import('../../src/client/collision/contact-between.ts').contactBetween;
  outerEdges: typeof import('../../src/client/utilities/polygon.ts').outerEdges;
  GameCollisions: typeof import('../../src/client/collision/game-collisions.ts').GameCollisions;
  GameObject: typeof import('../../src/client/objects/game-object.ts').GameObject;
  Module: typeof import('../../src/client/objects/modules/module.ts').Module;
  addEntity: typeof import('../../src/client/simulation/world.ts').addEntity;
  addPlayer: typeof import('../../src/client/simulation/world.ts').addPlayer;
  createWorld: typeof import('../../src/client/simulation/world.ts').createWorld;
  entityId: typeof import('../../src/client/simulation/world.ts').entityId;
  createPlayerShip: typeof import('../../src/client/objects/create-ship.ts').createPlayerShip;
  diamondDefinition: typeof import('../../src/definitions/items/index.ts').diamond;
  Item: typeof import('../../src/client/objects/item.ts').Item;
  createAsteroid: typeof import('../../src/client/objects/asteroid.ts').createAsteroid;
  updateWorld: typeof import('../../src/client/simulation/update-world.ts').updateWorld;
  captureWorld: typeof import('../../src/client/simulation/world-state.ts').captureWorld;
  restoreWorld: typeof import('../../src/client/simulation/world-state.ts').restoreWorld;
  controlShip: typeof import('../../src/client/objects/control-ship.ts').controlShip;
  simulationStep: typeof import('../../src/definitions/simulation.ts').simulationStep;
  sparks: typeof import('../../src/client/effects/shrapnel.ts').sparks;
  sprayDamage: typeof import('../../src/client/effects/shrapnel.ts').sprayDamage;
  damage: typeof import('../../src/client/objects/damage.ts').damage;
  computeDistance: typeof import('../../src/client/collision/shape-distance.ts').computeDistance;
  DistanceInput: typeof import('../../src/client/collision/shape-distance.ts').DistanceInput;
  DistanceOutput: typeof import('../../src/client/collision/shape-distance.ts').DistanceOutput;
  SimplexCache: typeof import('../../src/client/collision/shape-distance.ts').SimplexCache;
  SpatialGrid: typeof import('../../src/client/collision/spatial-grid.ts').SpatialGrid;
  AABB: typeof import('../../src/client/collision/axis-aligned-bounds.ts').AABB;
  PhysicsWorld: typeof import('../../src/client/physics/world.ts').World;
  CircleShape: typeof import('../../src/client/collision/shape/circle-shape.ts').CircleShape;
  PolygonShape: typeof import('../../src/client/collision/shape/polygon-shape.ts').PolygonShape;
  ShieldGenerator: typeof import('../../src/client/objects/modules/shield-generator.ts').ShieldGenerator;
  movePoint: typeof import('../../src/client/utilities/geometry.ts').movePoint;
  rotatePoint: typeof import('../../src/client/utilities/geometry.ts').rotatePoint;
  Vec: typeof import('../../src/client/utilities/vector.ts');
  matrix: typeof import('../../src/client/utilities/vector-math.ts');
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const {
  detectCollisions,
  contactBetween,
  movePoint,
  outerEdges,
  GameCollisions,
  GameObject,
  Module,
  createWorld,
  entityId,
  addEntity,
  addPlayer,
  createPlayerShip,
  diamondDefinition,
  Item,
  createAsteroid,
  updateWorld,
  controlShip,
  simulationStep,
  captureWorld,
  restoreWorld,
  rotatePoint,
  PolygonShape,
  ShieldGenerator,
  Vec,
} = physics;

const colliderOf = (
  fixture: import('../../src/client/physics/fixture').Fixture,
) =>
  fixture.getUserData() as import('../../src/client/collision/types').Collider;

const entityMap = (
  entities: import('../../src/client/objects/game-object').GameObject[],
) => new Map(entities.map((entity) => [entity.id, entity]));

// Multiple fixtures count as one neighbor. Deferred bodies return next step.
{
  const world = new physics.PhysicsWorld();

  world.limitCollisionNeighbors = true;
  const center = world.createBody();

  center.createFixture(new physics.CircleShape(Vec.create(), 20), {
    physics: false,
  });

  const neighbors = Array.from({ length: 9 }, (_, i) => {
    const body = world.createBody();

    body.setTransform(Vec.create(i + 1), 0);

    if (i < 8) {
      for (const radius of [0.5, 0.6]) {
        body.createFixture(new physics.CircleShape(Vec.create(), radius), {
          physics: false,
        });
      }
    }

    return body;
  });

  world.step(0, 8, 3);
  assert.equal(center.collisionNeighbors, undefined);

  neighbors[8].createFixture(new physics.CircleShape(Vec.create(), 0.5), {
    physics: false,
  });

  world.step(0, 8, 3);
  assert.equal(center.collisionNeighbors.length, 8);
  assert.equal(center.allowsCollision(neighbors[8]), false);
  neighbors[0].setTransform(Vec.create(100), 0);
  world.step(0, 8, 3);
  assert.equal(center.allowsCollision(neighbors[8]), true);
  center.resetCollisionNeighbors();

  for (const body of neighbors) center.addCollisionNeighbor(body, 1);

  assert.deepEqual(center.collisionNeighbors, neighbors.slice(0, 8));
}

const closeTo = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );

const polygon = (
  shapeOutline: import('../../src/client/types').ShapeOutline,
  properties: Partial<import('../../src/client/collision/types').Collider> = {},
) => ({
  shapeOutline,
  position: Vec.create(),
  radius: 20,
  rotation: 0,
  ...properties,
});

const body = ({
  id,
  mass,
  position = Vec.create(),
  velocity = Vec.create(),
}: {
  id: number;
  mass: number;
  position?: import('../../src/client/utilities/vector').Value;
  velocity?: import('../../src/client/utilities/vector').Value;
}) =>
  Object.assign(new GameObject(), {
    hitbox: () => [] as import('../../src/client/collision/types').Collider[],
    id,
    kind: 'item' as const,
    mass,
    position,
    radius: 1,
    rotation: 0,
    spin: 0,
    update: () => {},
    velocity,
  });

// Geometry helpers return plain vector coordinates.
const turned = rotatePoint(Vec.create(2), Math.PI / 2);
const moved = movePoint(turned, 0, 3);

closeTo(turned.x, 0);
closeTo(turned.y, 2);
closeTo(moved.x, 3);
closeTo(moved.y, 2);
assert.deepEqual(Object.keys(moved).sort(), ['x', 'y']);

// Circle-circle and circle-face contacts have exact penetration and normals.
let contact = contactBetween(
  { radius: 5, position: Vec.create() },
  { radius: 5, position: Vec.create(8) },
);

closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);

contact = contactBetween(
  polygon([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ]),
  { radius: 5, position: Vec.create(14) },
);
closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);

// A compound pentagon exposes each convex piece as a collider. At an outside
// vertex, the deepest contact has a radial normal and identifies its piece.
const corners = Array.from({ length: 5 }, (_, index) => [
  Math.cos((index * Math.PI * 2) / 5) * 10,
  Math.sin((index * Math.PI * 2) / 5) * 10,
]);

const colliders = corners.map((corner, index) => ({
  shapeOutline: [[0, 0], corner, corners[(index + 1) % corners.length]],
}));

outerEdges(colliders.map(({ shapeOutline }) => shapeOutline));
const compound = colliders.map(({ shapeOutline }) => polygon(shapeOutline));
const circleAtVertex = { radius: 5, position: Vec.create(14) };
const deepest = compound
  .map((piece) => contactBetween(piece, circleAtVertex))
  .filter(Boolean)
  .sort((a, b) => b.depth - a.depth)[0];

closeTo(deepest.depth, 2);
closeTo(deepest.normal.x, 1);
closeTo(deepest.normal.y, 0);

const owner = body({ id: 1, mass: 1 });
const otherOwner = body({ id: 2, mass: 1 });

const pieces: import('../../src/client/collision/types').Collider[] =
  compound.map((piece) => ({
    ...piece,
    owner,
    rotation: 0,
    friction: 0.2,
  }));

const circle = {
  friction: 0.2,
  owner: otherOwner,
  radius: 5,
  position: Vec.create(14),
  rotation: 0,
};

owner.hitbox = () => pieces;

otherOwner.hitbox = () => [
  circle,
  {
    ...circle,
    owner,
    position: Vec.create(
      14 * Math.cos((Math.PI * 2) / 5),
      14 * Math.sin((Math.PI * 2) / 5),
    ),
  },
];

const contacts = detectCollisions({ entities: [owner, otherOwner] });

assert(contacts.length > 0);
assert(
  contacts.every(
    ({ collider, other }) => pieces.includes(collider) && other === circle,
  ),
);

// Loose cargo modules have no shape, even when many leave a wreck at once.
{
  const modules = Array.from(
    { length: 12 },
    (_, index) => new Module({ id: 11000 + index }),
  );

  const contacts = new GameCollisions().step({
    entities: entityMap(modules),
    previous: new Map(),
    dt: 1 / 30,
  });

  assert.equal(contacts.length, 0);
}

// Object mass is independent of geometry; only physical shapes set spin resistance.
assert.equal(new GameObject().mass, 3);

{
  const object = new GameObject({ id: 90, mass: 10, radius: 0 });

  object.angularInertiaScale = 3;

  object.hitbox = () => [
    {
      owner: object,
      position: Vec.create(),
      rotation: 0,
      radius: 2,
      friction: 0.01,
    },
    {
      owner: object,
      position: Vec.create(6),
      rotation: 0,
      radius: 1,
      friction: 0.01,
    },
    {
      owner: object,
      position: Vec.create(100),
      rotation: 0,
      radius: 20,
      friction: 0.01,
      physics: false,
    },
  ];

  const collisions = new GameCollisions();

  collisions.step({
    entities: entityMap([object]),
    previous: new Map(),
    dt: 1 / 30,
  });

  const solverBody = collisions['bodies'].get(object.id).body;

  closeTo(solverBody.m_invMass, 1 / 10);
  closeTo(solverBody.m_invI, 1 / (10 * 8.9 * 3));

  object.hitbox = () => [
    {
      owner: object,
      position: Vec.create(5),
      rotation: 0,
      radius: 0,
      shapeOutline: [
        [-2, -1],
        [2, -1],
        [2, 1],
        [-2, 1],
      ],
      friction: 0.01,
    },
  ];

  collisions.step({
    entities: entityMap([object]),
    previous: new Map(),
    dt: 1 / 30,
  });

  closeTo(collisions['bodies'].get(object.id).body.m_invI, 1 / 800);

  object.mass = 100;

  collisions.step({
    entities: entityMap([object]),
    previous: new Map(),
    dt: 1 / 30,
  });

  closeTo(collisions['bodies'].get(object.id).body.m_invMass, 1 / 100);
  closeTo(collisions['bodies'].get(object.id).body.m_invI, 1 / 8000);
}

// Moving rigid shapes reuse fixtures; geometry and collision flags invalidate them.
{
  const object = new GameObject({ id: 900, mass: 10, radius: 4 });

  const collider: import('../../src/client/collision/types').Collider = {
    owner: object,
    position: object.position,
    rotation: object.rotation,
    radius: 4,
    friction: 0.1,
  };

  object.hitbox = () => [collider];
  const collisions = new GameCollisions();

  const sync = () => {
    collisions.step({
      entities: entityMap([object]),
      previous: new Map(),
      dt: 1 / 30,
    });

    return collisions['bodies'].get(object.id).fixtures[0];
  };

  let fixture = sync();

  Vec.setXY(object.position, 12345, -98765);
  collider.rotation = object.rotation = 0.7;
  assert.equal(sync(), fixture, 'rigid motion preserves the fixture');
  collider.radius += 1e-8;
  assert.equal(sync(), fixture, 'sub-quantisation noise preserves the fixture');
  collider.friction = 0.5;
  assert.equal(sync(), fixture, 'material updates preserve the fixture');
  assert.equal(colliderOf(fixture).friction, 0.5);

  for (const change of [
    () => (collider.radius = 5),
    () =>
      (collider.shapeOutline = [
        [-2, -1],
        [2, -1],
        [2, 1],
        [-2, 1],
      ]),
    () => (collider.shapeOutline[0][0] = -3),
    () => (collider.collisionMargin = 0),
    () => delete collider.collisionMargin,
    () => (collider.physics = false),
    () => (collider.pickupPoint = true),
    () => (collider.role = 'cargoHatch'),
    () => (object.mass = 20),
    () => (object.angularInertiaScale = 2),
    () => delete collider.shapeOutline,
  ]) {
    change();
    const changed = sync();

    assert.notEqual(
      changed,
      fixture,
      'a geometry or collision flag change rebuilds the fixture',
    );
    fixture = changed;
    assert.equal(
      sync(),
      fixture,
      'unchanged geometry reuses the rebuilt fixture',
    );
  }

  collider.collides = false;
  assert.equal(sync(), undefined, 'disabled colliders remove their fixtures');
  collider.collides = true;
  assert.ok(sync(), 'reenabled colliders recreate their fixtures');
}

// Off-centre impacts exchange angular as well as linear momentum.
const triangle = new GameObject({
  id: 10,
  mass: 200,
  radius: 30,
  shapeOutline: [
    [-20, -20],
    [20, 0],
    [-20, 20],
  ],
  drag: 0,
  maxSpeed: 10000,
});

const projectile = new GameObject({
  id: 11,
  mass: 6,
  radius: 3,
  position: Vec.create(15, -20),
  velocity: Vec.create(0, 200),
  drag: 0,
  maxSpeed: 10000,
});

const torqueWorld = createWorld();

addEntity(torqueWorld, triangle);
addEntity(torqueWorld, projectile);
const beforeImpact = captureWorld({ world: torqueWorld });

for (let i = 0; i < 20; i++) {
  updateWorld({ world: torqueWorld, inputs: new Map() });
}

assert(
  Math.abs(triangle.spin) > 0.01,
  'pushing a triangular tip rotates the rock',
);

const impactResult = {
  position: Vec.add(triangle.position, Vec.create()),
  spin: triangle.spin,
};

restoreWorld({ world: torqueWorld, state: beforeImpact });

for (let i = 0; i < 20; i++) {
  updateWorld({ world: torqueWorld, inputs: new Map() });
}

closeTo(Vec.distance(triangle.position, impactResult.position), 0, 1e-7);
closeTo(triangle.spin, impactResult.spin, 1e-7);

// Strong collisions deal about twice the old damage on both bodies.
{
  const world = createWorld();

  const left = addEntity(
    world,
    new GameObject({
      id: 100,
      mass: 200,
      radius: 5,
      health: 100,
      shades: ['#111', '#222', '#f00'],
      position: Vec.create(-6),
      velocity: Vec.create(100),
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  const right = addEntity(
    world,
    new GameObject({
      id: 101,
      mass: 200,
      radius: 5,
      health: 100,
      shades: ['#111', '#222', '#0af'],
      position: Vec.create(6),
      velocity: Vec.create(-100),
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  const events = updateWorld({ world, inputs: new Map() });

  const collision = events.find(({ type }) => type === 'collision');

  assert(collision?.type === 'collision');
  assert.deepEqual(new Set(collision.colors), new Set(['#f00', '#0af']));
  assert.equal(left.health, 68);
  assert.equal(right.health, 68);
}

// Light items cannot chip a ship at ordinary closing speed, but an unusually
// fast item can still cause damage.
const itemShipImpact = (speed: number, mass?: number) => {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world));

  const item = addEntity(
    world,
    new Item(diamondDefinition, {
      world,
      id: entityId(world),
      position: Vec.create(-50),
      velocity: Vec.create(speed),
      maxSpeed: 10000,
      drag: 0,
      ...(mass === undefined ? {} : { mass }),
    }),
  );

  const before = ship.hullHealthTotal;

  for (let tick = 0; tick < 15; tick++) {
    const events = updateWorld({ world, inputs: new Map() });

    const collision = events.find(
      (event) =>
        event.type === 'collision' &&
        ((event.a === ship.id && event.b === item.id) ||
          (event.a === item.id && event.b === ship.id)),
    );

    if (collision?.type === 'collision') {
      return {
        damage: before - ship.hullHealthTotal,
        collision,
        velocity: Vec.clone(ship.velocity),
      };
    }
  }

  throw new Error('item never reached the ship');
};

assert.equal(
  itemShipImpact(200).damage,
  0,
  'ordinary item-to-ship contact does no hull damage',
);
const lightImpact = itemShipImpact(400);
const oldImpact = itemShipImpact(400, 6);

assert.equal(
  lightImpact.damage,
  0,
  'lighter items do not chip the hull at cruising speed',
);
assert.deepEqual(
  lightImpact.collision.damage,
  [0, 0],
  'harmless contact reports no damage for either surface',
);
assert(
  oldImpact.damage > 0,
  'the old item mass would damage the ship at this speed',
);
assert(
  Vec.length(lightImpact.velocity) < Vec.length(oldImpact.velocity) * 0.75,
  'lighter items deflect the ship substantially less',
);
assert(
  itemShipImpact(600).damage > 0,
  'an unusually fast item can damage a ship',
);

// A fast ship damages the contacted asteroid segment, not the whole body's health.
{
  const world = createWorld();

  const ship = addEntity(
    world,
    createPlayerShip(world, {
      playerId: 1,
      position: Vec.create(-85, 22.5),
      velocity: Vec.create(400),
    }),
  );

  addPlayer(world, { id: 1, shipId: ship.id });

  const rock = addEntity(
    world,
    createAsteroid(world, {
      radius: 25,
      pointCount: 5,
      contents: [0, 1, 2, 3],
    }),
  );

  const health = rock.health;

  const events: import('../../src/client/protocol/events').SimulationEvent[] =
    [];

  for (let tick = 0; tick < 60; tick++) {
    events.push(...updateWorld({ world: world, inputs: new Map() }));
  }

  assert.equal(
    rock.health,
    health,
    'impact damage belongs to the struck asteroid segment',
  );
  assert(
    events.some(({ type }) => type === 'asteroidSplit'),
    'a broken impact asteroid segment splits off without a drill',
  );
  assert.deepEqual(
    [...world.entities.values()]
      .flatMap((entity) => entity.contents || [])
      .sort((a, b) => a - b),
    [0, 1, 2, 3],
  );
}

// Hull construction keeps every convex vertex and still supports swept contact.
for (const count of [20, 30]) {
  const shapeOutline = Array.from({ length: count }, (_, index) => {
    const angle = (index * Math.PI * 2) / count;

    return [Math.cos(angle) * 20, Math.sin(angle) * 20];
  });

  const shape = new PolygonShape(
    shapeOutline.map(([x, y]) => Vec.create(x, y)),
  );

  assert.equal(
    shape.m_count,
    count,
    `the ${count}-point hull is not truncated`,
  );

  const mover = new GameObject({
    id: 600 + count,
    mass: 6,
    radius: 0.5,
    position: Vec.create(180),
  });

  const obstacle = new GameObject({
    id: 700 + count,
    mass: 1e9,
    position: Vec.create(90),
    shapeOutline,
  });

  const contacts = new GameCollisions().step({
    entities: entityMap([mover, obstacle]),
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vec.create(), rotation: 0 }]]),
  });

  assert(
    contacts.some(
      ({ collider, other }) =>
        collider.owner === obstacle || other.owner === obstacle,
    ),
    `a fast body meets the ${count}-point obstacle`,
  );
  assert(mover.position.x < obstacle.position.x);
}

// CCD must stop a small body crossing a thin moving-body collider in one tick.
const ccdWorld = createWorld();

const fast = addEntity(
  ccdWorld,
  new GameObject({
    mass: 6,
    radius: 1,
    position: Vec.create(-50),
    velocity: Vec.create(6000),
    drag: 0,
    maxSpeed: 10000,
  }),
);

const wall = addEntity(
  ccdWorld,
  new GameObject({
    mass: 100000,
    radius: 30,
    shapeOutline: [
      [-0.5, -30],
      [0.5, -30],
      [0.5, 30],
      [-0.5, 30],
    ],
    drag: 0,
    maxSpeed: 10000,
  }),
);

updateWorld({ world: ccdWorld, inputs: new Map() });
assert(
  fast.position.x < wall.position.x,
  'CCD prevents crossing the thin face',
);

// A bullet may strike another face after its first bounce within one tick.
// The solver's internal TOI loop must continue after the first impact.
{
  const mover = new GameObject({
    id: 35,
    mass: 6,
    radius: 1,
    position: Vec.create(50),
    velocity: Vec.create(1500),
    bounciness: 0.5,
  });

  const faces = [-10, 10].map(
    (x, index) =>
      new GameObject({
        id: 36 + index,
        radius: 1,
        mass: 1e9,
        position: Vec.create(x),
        bounciness: 0.5,
      }),
  );

  const contacts = new GameCollisions().step({
    entities: entityMap([mover, ...faces]),
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vec.create(), rotation: 0 }]]),
  });

  assert(
    faces.every((face) =>
      contacts.some(
        ({ collider, other }) =>
          collider.owner === face || other.owner === face,
      ),
    ),
    'two separate physical faces contact one fast body in a tick',
  );
}

// A small stationary bullet must also meet a narrow obstacle sweeping across
// it; CCD cannot rely only on movement of the smaller body.
{
  const target = new GameObject({ id: 38, mass: 6, radius: 0.5 });

  const movingWall = new GameObject({
    id: 39,
    mass: 100000,
    radius: 20,
    position: Vec.create(20),
    shapeOutline: [
      [-0.25, -20],
      [0.25, -20],
      [0.25, 20],
      [-0.25, 20],
    ],
  });

  const contacts = new GameCollisions().step({
    entities: entityMap([target, movingWall]),
    dt: 1 / 30,
    previous: new Map([
      [movingWall.id, { position: Vec.create(-20), rotation: 0 }],
    ]),
  });

  assert(
    contacts.some(
      ({ collider, other }) =>
        collider.owner === target || other.owner === target,
    ),
    'a moving thin obstacle contacts a small target during its sweep',
  );
}

// Crossings on both sides of the 200-game-unit solver translation cap still
// find a thin face when the impact lies within the permitted translation.
for (const travel of [190, 210, 400]) {
  const mover = new GameObject({
    id: 90 + travel,
    mass: 6,
    radius: 0.5,
    position: Vec.create(travel),
  });

  const face = new GameObject({
    id: 91 + travel,
    mass: 1e9,
    position: Vec.create(90),
    shapeOutline: [
      [-0.25, -20],
      [0.25, -20],
      [0.25, 20],
      [-0.25, 20],
    ],
  });

  const contacts = new GameCollisions().step({
    entities: entityMap([mover, face]),
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vec.create(), rotation: 0 }]]),
  });

  assert(
    contacts.some(
      ({ collider, other }) =>
        collider.owner === mover || other.owner === mover,
    ),
    `a ${travel}-unit crossing finds the thin face`,
  );
  assert(mover.position.x < face.position.x, 'the body stays before the face');
}

// A trigger crossed beyond the cap reports an event without changing the
// solver's capped motion or applying a contact impulse.
{
  const makeMover = (id: number) =>
    new GameObject({ id, mass: 6, radius: 0.5, position: Vec.create(400) });
  const baseline = makeMover(496);
  const crossing = makeMover(497);

  const trigger = new GameObject({
    id: 498,
    position: Vec.create(90),
    radius: 1,
  });

  trigger.hitbox = () => [
    {
      owner: trigger,
      position: trigger.position,
      rotation: 0,
      radius: 1,
      physics: false,
      friction: trigger.friction,
    },
  ];

  const previous = (
    mover: import('../../src/client/objects/game-object').GameObject,
  ) => new Map([[mover.id, { position: Vec.create(), rotation: 0 }]]);

  new GameCollisions().step({
    entities: entityMap([baseline]),
    dt: 1 / 30,
    previous: previous(baseline),
  });

  const contacts = new GameCollisions().step({
    entities: entityMap([crossing, trigger]),
    dt: 1 / 30,
    previous: previous(crossing),
  });

  assert(contacts.length > 0, 'the fast crossing reaches the trigger');
  closeTo(crossing.position.x, baseline.position.x);
  closeTo(crossing.velocity.x, baseline.velocity.x);
}

// Fixture synchronisation must rebuild changing shape outlines and discard the old
// broad-phase proxy when the shape outline shrinks again.
{
  const obstacle = new GameObject({
    id: 500,
    position: Vec.create(),
    shapeOutline: [
      [-1, -5],
      [1, -5],
      [1, 5],
      [-1, 5],
    ],
  });

  const target = new GameObject({
    id: 501,
    mass: 5,
    radius: 1,
    position: Vec.create(8),
  });

  const collisions = new GameCollisions();

  const step = () =>
    collisions.step({
      entities: entityMap([obstacle, target]),
      dt: 1 / 30,
      previous: new Map(),
    });

  assert.equal(step().length, 0);
  obstacle.shapeOutline = [
    [-1, -5],
    [10, -5],
    [10, 5],
    [-1, 5],
  ];
  assert(step().length > 0, 'a grown shapeOutline acquires a contact');
  obstacle.shapeOutline = [
    [-1, -5],
    [1, -5],
    [1, 5],
    [-1, 5],
  ];
  assert.equal(step().length, 0, 'a shrunk shapeOutline releases its contact');
}

// Nonphysical contacts use the physics broad phase but apply no impulse.
const trigger = new GameObject({
  id: 40,
  mass: 6,
  radius: 10,
});

trigger.hitbox = () => [
  {
    owner: trigger,
    position: trigger.position,
    radius: 10,
    rotation: 0,
    physics: false,
    friction: trigger.friction,
    role: 'cargoHatch',
  },
];

const triggerTarget = new GameObject({
  id: 41,
  mass: 10,
  radius: 2,
  position: Vec.create(5),
});

const distantTarget = new GameObject({
  id: 42,
  mass: 10,
  radius: 2,
  position: Vec.create(15000),
});

const triggerContacts = new GameCollisions().step({
  entities: entityMap([trigger, triggerTarget, distantTarget]),
  dt: 1 / 60,
  previous: new Map(),
});

assert(
  triggerContacts.some(
    ({ collider, other }) =>
      collider.role === 'cargoHatch' && other.owner === triggerTarget,
  ),
  'overlapping nonphysical fixtures report a contact',
);
assert(
  triggerContacts.every(({ other }) => other.owner !== distantTarget),
  'distant objects do not contact the trigger',
);
closeTo(triggerTarget.position.x, 5);

const fastTriggerTarget = new GameObject({
  id: 44,
  mass: 10,
  radius: 2,
  position: Vec.create(25),
});

const continuousContacts = new GameCollisions().step({
  entities: entityMap([trigger, fastTriggerTarget]),
  dt: 1 / 60,
  previous: new Map([
    [fastTriggerTarget.id, { position: Vec.create(-25), rotation: 0 }],
  ]),
});

assert(
  continuousContacts.some(({ other }) => other.owner === fastTriggerTarget),
  'a nonphysical contact detects a complete crossing between ticks',
);
closeTo(fastTriggerTarget.position.x, 25);
closeTo(fastTriggerTarget.velocity.x, 0);

// A pickup point crossing the open mouth between ticks still collects cargo.
// The item's physical body remains separate from its nonphysical centre point.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 7 }));
  const mouthPart = ship.segments.find((segment) => segment.catches);

  ship.segments
    .filter((segment) => segment.module === mouthPart.module)
    .forEach((segment) => {
      segment.active = 1;
      segment.activationProgress = 1;
    });

  const mouth = ship.hitbox().find((box) => box.segment === mouthPart);
  const crossingY = mouth.position.y - 10;

  const item = addEntity(
    world,
    new Item(diamondDefinition, {
      world,
      id: entityId(world),
      position: Vec.create(mouth.position.x - 25, crossingY),
    }),
  );

  const crossingContacts = new GameCollisions().step({
    entities: entityMap([ship, item]),
    previous: new Map([
      [
        item.id,
        { position: Vec.create(mouth.position.x + 25, crossingY), rotation: 0 },
      ],
    ]),
    dt: 1 / 30,
  });

  assert(
    crossingContacts.some(
      ({ collider, other }) =>
        (collider.segment === mouthPart && other.pickupPoint) ||
        (other.segment === mouthPart && collider.pickupPoint),
    ),
    'continuous collision detects the item centre crossing the mouth',
  );
  assert(
    crossingContacts.every(
      ({ collider, other }) =>
        (!collider.pickupPoint && !other.pickupPoint) ||
        collider.segment === mouthPart ||
        other.segment === mouthPart,
    ),
    'item centre contacts are filtered to cargo hatch mouths',
  );
  assert(
    crossingContacts.every(
      ({ collider, other }) =>
        (collider.role !== 'cargoHatch' || other.pickupPoint) &&
        (other.role !== 'cargoHatch' || collider.pickupPoint),
    ),
    'cargo hatch mouths ignore the item body and all other solid colliders',
  );

  const events: import('../../src/client/protocol/events').SimulationEvent[] =
    [];

  ship.handleContacts({
    contacts: crossingContacts,
    events,
    world,
    dt: 1 / 30,
  });

  assert(ship.cargoContents.includes(item), 'the crossing item enters cargo');
  assert(
    Vec.distance(item.position, mouth.position) > mouth.radius,
    'pickup occurs even though the item ends the tick beyond the mouth',
  );
  assert(events.some(({ type }) => type === 'itemCollected'));
}

const swinging = new GameObject({
  id: 42,
  mass: 100,
  radius: 51,
  rotation: Math.PI / 2,
  shapeOutline: [
    [0, -0.5],
    [50, -0.5],
    [50, 0.5],
    [0, 0.5],
  ],
});

const struck = new GameObject({
  id: 43,
  mass: 6,
  radius: 2,
  position: Vec.create(35.35, 35.35),
});

const angularContacts = new GameCollisions().step({
  entities: entityMap([swinging, struck]),
  dt: 1 / 60,
  previous: new Map([[swinging.id, { position: Vec.create(), rotation: 0 }]]),
});

assert(
  angularContacts.length > 0 && Vec.length(struck.velocity) > 0,
  'a thin rotating solid sweeps and pushes the item',
);

// Each fixture uses its collider's material, including explicit zero values.
// A subclass without a material override inherits the game object's default.
class DefaultMaterial extends GameObject {}

assert.equal(new DefaultMaterial({ id: 460 }).friction, 0.01);

class ZeroMaterial extends GameObject {
  static friction = 0;
}

assert.equal(new ZeroMaterial({ id: 461 }).friction, 0);

// tangential friction and a negative contribution damps exaggerated bounce.
{
  const parent = new GameObject({
    id: 46,
    mass: 9,
    radius: 5,
    friction: 0,
    bounciness: -0.4,
  });

  parent.hitbox = () => [
    {
      owner: parent,
      position: parent.position,
      radius: 5,
      rotation: 0,
      friction: parent.friction,
      bounciness: parent.bounciness,
    },
  ];

  const other = new GameObject({
    id: 47,
    mass: 9,
    radius: 5,
    position: Vec.create(9),
    friction: 0.25,
    bounciness: 3,
  });

  const solver = new GameCollisions();

  const contacts = solver.step({
    entities: entityMap([parent, other]),
    dt: 1 / 30,
    previous: new Map([[other.id, { position: Vec.create(9.5), rotation: 0 }]]),
  });

  const contact = solver['world'].m_contactList;

  assert(contacts.length, 'the physical collider contacts its target');
  assert.equal(contact.getFriction(), 0, 'explicit zero friction wins the mix');
  closeTo(contact.getRestitution(), 1.3);
  assert.equal(colliderOf(contact.getFixtureA()).friction, 0);
  assert.equal(colliderOf(contact.getFixtureA()).bounciness, -0.4);
}

// Low-speed contact keeps the existing bounce threshold with positive friction.
{
  const first = new GameObject({ id: 48, mass: 9, radius: 5 });

  const second = new GameObject({
    id: 49,
    mass: 9,
    radius: 5,
    position: Vec.create(9),
    friction: 0.25,
    bounciness: 3,
  });

  const solver = new GameCollisions();

  solver.step({
    entities: entityMap([first, second]),
    dt: 1 / 30,
    previous: new Map([
      [second.id, { position: Vec.create(9.1), rotation: 0 }],
    ]),
  });

  const contact = solver['world'].m_contactList;

  closeTo(contact.getFriction(), 0.05);
  assert.equal(contact.getRestitution(), 0);
}

// Changing material without changing geometry updates an existing contact.
{
  const first = new GameObject({ id: 480, mass: 9, radius: 5, friction: 0.25 });

  const second = new GameObject({
    id: 481,
    mass: 9,
    radius: 5,
    position: Vec.create(9),
    friction: 0.25,
  });

  const solver = new GameCollisions();

  const step = () =>
    solver.step({
      entities: entityMap([first, second]),
      dt: 0,
      previous: new Map(),
    });

  step();
  const fixture = solver['world'].m_contactList.getFixtureA();

  closeTo(solver['world'].m_contactList.getFriction(), 0.25);
  first.friction = 0;
  step();
  assert.equal(solver['world'].m_contactList.getFixtureA(), fixture);
  assert.equal(solver['world'].m_contactList.getFriction(), 0);
}

// Preserve the earlier hull/shield pair response under averaged material
// contributions, as well as mass-weighted push.
const bounce = (bounciness: number) => {
  const world = createWorld();

  const moving = addEntity(
    world,
    new GameObject({
      mass: 9,
      radius: 5,
      velocity: Vec.create(100),
      bounciness,
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  const heavy = addEntity(
    world,
    new GameObject({
      mass: 200,
      radius: 5,
      position: Vec.create(14),
      bounciness: 0.1,
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  for (let i = 0; i < 6; i++) updateWorld({ world: world, inputs: new Map() });
  closeTo(
    moving.mass * moving.velocity.x + heavy.mass * heavy.velocity.x,
    900,
    // Six ticks, four motion substeps and final contact rounding per tick.
    // Each eight-decimal velocity rounding contributes at most half a unit.
    6 * 5 * (moving.mass + heavy.mass) * 0.5e-8,
  );
  assert(heavy.velocity.x > 0);
  return moving.velocity.x;
};

assert(
  bounce(0.4) < bounce(0.1),
  'shield bounce stays stronger than hull bounce',
);

// Growing shield geometry has a surface velocity even when its ship is still.
// It must launch a nearby item, then stop supplying that velocity once open.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world));
  const shield = new ShieldGenerator();

  ship.cargoContents.push(shield);
  ship.fit(shield);
  ship.setModuleActive({ module: ShieldGenerator, active: true });

  const item = addEntity(
    world,
    new Item(diamondDefinition, {
      world,
      id: entityId(world),
      position: Vec.create(54),
    }),
  );

  for (let tick = 0; tick < 6; tick++) {
    updateWorld({ world, inputs: new Map() });
  }

  assert(item.velocity.x > 20, 'the expanding shield bounces a nearby item');
  assert(ship.velocity.x < 0, 'the expansion impulse pushes back on the ship');
  updateWorld({ world, inputs: new Map() });
  const cover = ship.hitbox().find(({ segment }) => segment?.covers);

  assert.equal(cover.speed, 0, 'a fully extended shield stops expanding');
}

// Two player ships use the raised shield as their physical collision surface.
const playerCollision = (shielded: boolean) => {
  const world = createWorld();

  const left = addEntity(
    world,
    createPlayerShip(world, {
      playerId: 1,
      position: Vec.create(-120),
      velocity: Vec.create(200),
    }),
  );

  const right = addEntity(
    world,
    createPlayerShip(world, {
      playerId: 2,
      position: Vec.create(120),
      velocity: Vec.create(-200),
    }),
  );

  addPlayer(world, { id: 1, shipId: left.id });
  addPlayer(world, { id: 2, shipId: right.id });

  if (shielded) left.fit(new ShieldGenerator());

  const inputs = new Map(
    [1, 2].map((id) => [
      id,
      {
        thrust: 0,
        turn: 0,
        hornDrill: false,
        cargoHatch: false,
        searchLight: false,
        shieldGenerator: shielded && id === 1,
        launch: false,
      },
    ]),
  );

  for (let tick = 0; tick < 60; tick++) {
    const collision = updateWorld({ world, inputs }).find(
      ({ type }) => type === 'collision',
    );

    if (collision?.type === 'collision') {
      const leftIndex = collision.a === left.id ? 0 : 1;

      assert.equal(
        collision.damage[leftIndex] === 0,
        shielded,
        'raised shields report no damage',
      );
      assert(
        collision.damage[1 - leftIndex] > 0,
        'the unshielded hull takes damage',
      );

      return {
        tick,
        leftVelocity: left.velocity.x,
        rightVelocity: right.velocity.x,
      };
    }
  }

  throw new Error('player ships never collided');
};

const hullCollision = playerCollision(false);
const shieldCollision = playerCollision(true);

assert.equal(shieldCollision.tick, hullCollision.tick);
assert(
  shieldCollision.leftVelocity < hullCollision.leftVelocity - 10,
  'a raised shield rebounds harder against another player ship',
);
assert(
  shieldCollision.rightVelocity > hullCollision.rightVelocity + 10,
  'the other player receives the shield rebound',
);

// Each asteroid segment becomes one fixture with its own damage target.
{
  const world = createWorld();
  const asteroid = createAsteroid(world, { radius: 25, pointCount: 7 });
  const colliders = asteroid.hitbox();

  assert.equal(colliders.length, asteroid.segments.length);

  colliders.forEach((collider, index) => {
    assert.equal(collider.asteroidSegment, asteroid.segments[index]);
    assert.equal(collider.shapeOutline, asteroid.segments[index].shapeOutline);
    assert.equal(collider.bounciness, 0.2);
    assert.equal(collider.collisionMargin, 0);
  });

  const solver = new GameCollisions();

  solver.step({
    entities: entityMap([asteroid]),
    previous: new Map(),
    dt: 1 / 60,
  });

  let fixture = solver['world'].m_bodyList.m_fixtureList;

  const targets: import('../../src/client/protocol/entities').AsteroidSegment[] =
    [];

  while (fixture) {
    targets.push(colliderOf(fixture).asteroidSegment);
    fixture = fixture.m_next;
  }

  assert.equal(targets.length, asteroid.segments.length);
  assert(asteroid.segments.every((segment) => targets.includes(segment)));
}

// Once an asteroid segment detaches, touching cut faces must not create an artificial
// separation impulse. Remove the intentional split drift to isolate the solver.
for (const radiusEven of [undefined, 25]) {
  const world = createWorld();

  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      radius: 100,
      pointCount: radiusEven ? 6 : 7,
      radiusEven,
      rotation: 0.4,
      position: Vec.create(200, 300),
    }),
  );

  const children = asteroid.detach({
    asteroidSegment: asteroid.segments[0],
    world,
  });

  const leaf = children[0];
  const visualShapeOutline = JSON.stringify(leaf.shapeOutline);

  leaf.hitbox()[0].shapeOutline.forEach(([x, y], index) => {
    closeTo(
      Vec.distance(Vec.create(x, y), Vec.create(...leaf.shapeOutline[index])),
      0.1,
    );
  });

  const positions = children.map((child) =>
    Vec.add(child.position, Vec.create()),
  );

  children.forEach((child) => {
    Vec.set(child.velocity, Vec.create());
    child.spin = 0;
  });

  assert.equal(
    detectCollisions({ entities: children }).length,
    0,
    'split pieces have no padded collision overlap',
  );

  for (let tick = 0; tick < 10; tick++) {
    updateWorld({ world: world, inputs: new Map() });
  }

  children.forEach((child, index) => {
    // Initial geometry coordinates settle onto the motion grid on first update.
    closeTo(
      Vec.distance(child.position, positions[index]),
      0,
      Math.SQRT2 * 2 ** -25,
    );
    closeTo(child.spin, 0, 1e-8);
  });

  assert.equal(
    JSON.stringify(leaf.shapeOutline),
    visualShapeOutline,
    'collision clearance does not alter the rendered chunk',
  );
}

// In unobstructed flight the solver must not replace steering or drag.
const flightWorld = createWorld();
const flying = addEntity(flightWorld, createPlayerShip(flightWorld, { playerId: 1 }));

addPlayer(flightWorld, { id: 1, shipId: flying.id });
const referenceWorld = createWorld();
const reference = createPlayerShip(referenceWorld, { playerId: 1 });

for (let tick = 0; tick < 240; tick++) {
  const input = {
    thrust: tick < 120 ? 1 : 0,
    turn: tick < 30 ? 1 : tick < 60 ? -1 : 0,
    hornDrill: false,
    cargoHatch: false,
    searchLight: false,
    shieldGenerator: false,
    launch: false,
  };

  controlShip(reference, input, []);
  reference.update(1 / 60);
  reference.update(1 / 60);
  updateWorld({ world: flightWorld, inputs: new Map([[1, input]]) });
  closeTo(Vec.distance(flying.position, reference.position), 0, 1e-7);
  closeTo(Vec.distance(flying.velocity, reference.velocity), 0, 1e-7);
  closeTo(flying.rotation, reference.rotation, 1e-9);
}

// Recorded against commit 6adcc82, holding left/right for five seconds
// then releasing. The 60 Hz integrator keeps the acceleration/braking curve;
// allow half of the old/new step difference in integrated angle, not slower steering.
for (const direction of [-1, 1]) {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  let angle = 0;
  let referenceAngle = 0;
  let referenceSpin = 0;
  let fullTurnTime;

  for (let tick = 1; tick <= 6 / simulationStep; tick++) {
    const turn = tick <= 5 / simulationStep ? direction : 0;

    for (let part = 0; part < Math.round(simulationStep * 120); part++) {
      const change = Math.max(
        -16 / 120,
        Math.min(16 / 120, turn * 3 - referenceSpin),
      );

      referenceSpin += change;
      referenceAngle += referenceSpin / 120;
    }

    const previous = ship.rotation;
    const before = angle;

    updateWorld({
      world: world,
      inputs: new Map([
        [
          1,
          {
            thrust: 0,
            turn,
            hornDrill: false,
            cargoHatch: false,
            searchLight: false,
            shieldGenerator: false,
            launch: false,
          },
        ],
      ]),
    });

    angle += Math.atan2(
      Math.sin(ship.rotation - previous),
      Math.cos(ship.rotation - previous),
    );
    closeTo(angle, referenceAngle, 0.013);
    closeTo(ship.spin, referenceSpin, 2e-6);

    if (fullTurnTime === undefined && angle * direction >= 4 * Math.PI) {
      fullTurnTime =
        (tick - 1) * simulationStep +
        ((4 * Math.PI - before * direction) / ((angle - before) * direction)) *
          simulationStep;
    }
  }

  closeTo(fullTurnTime, 4.278419834415983, 1 / 120);
  closeTo(ship.spin, 0);
}

const offCentreStrike = ({
  angularInertiaScale,
}: {
  angularInertiaScale?: number;
}) => {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  if (angularInertiaScale !== undefined) {
    ship.angularInertiaScale = angularInertiaScale;
  }

  addPlayer(world, { id: 1, shipId: ship.id });

  addEntity(
    world,
    new GameObject({
      position: Vec.create(-70, -25),
      velocity: Vec.create(150),
      radius: 5,
      mass: 9,
      drag: 0,
    }),
  );

  let peakSpin = 0;

  for (let tick = 0; tick < 20; tick++) {
    updateWorld({ world: world, inputs: new Map() });
    peakSpin = Math.max(peakSpin, Math.abs(ship.spin));
  }

  return peakSpin;
};

const originalImpactSpin = offCentreStrike({ angularInertiaScale: 1 });
const resistedImpactSpin = offCentreStrike({});

assert(
  originalImpactSpin > 1 && resistedImpactSpin > 0,
  'the off-centre strike causes real rotation',
);
assert(
  resistedImpactSpin < originalImpactSpin * 0.85,
  'ship inertia reduces collision spin without changing steering',
);

// Item coast uses exactly the old drag and low-speed cutoff, not solver damping.
const driftWorld = createWorld();

const drifting = addEntity(
  driftWorld,
  new Item(diamondDefinition, {
    world: driftWorld,
    id: entityId(driftWorld),
    velocity: Vec.create(150),
  }),
);

const driftReferenceWorld = createWorld();

const referenceItem = new Item(diamondDefinition, {
  world: driftReferenceWorld,
  id: entityId(driftReferenceWorld),
  velocity: Vec.create(150),
});

for (let tick = 0; tick < 2200; tick++) {
  referenceItem.update(1 / 60);
  referenceItem.update(1 / 60);
  updateWorld({ world: driftWorld, inputs: new Map() });
  closeTo(Vec.distance(drifting.position, referenceItem.position), 0, 1e-7);
  closeTo(Vec.distance(drifting.velocity, referenceItem.velocity), 0, 1e-7);
}

assert.equal(Vec.length(drifting.velocity), 0);
console.log(
  'CCD, angular response, shield bounce, original steering and drift passed',
);

// Browser-only damage still emits each surface colour at the impact point;
// presentation remains outside the headless resolver.

const damagedHull: Partial<import('../../src/client/types').Segment> = {
  health: 10,
  shades: ['dark', 'fill', '#f00'],
};

const damagedRock = { health: 10 };

physics.sparks.length = 0;
physics.damage(
  damagedHull as import('../../src/client/types').Segment,
  2,
  [7, 3],
);
physics.damage(
  Object.assign(new GameObject(), damagedRock, { stroke: '#abc' }),
  2,
  [7, 3],
);
assert.equal(
  physics.sparks.length,
  0,
  'shared damage never creates cosmetic objects',
);
physics.sprayDamage({ position: Vec.create(7, 3), color: '#f00', damage: 2 });
physics.sprayDamage({ position: Vec.create(7, 3), color: '#abc', damage: 2 });
assert.deepEqual(
  physics.sparks.map(({ position, color }) => [position.x, position.y, color]),
  [...Array(4).fill([7, 3, '#f00']), ...Array(4).fill([7, 3, '#abc'])],
);

physics.sparks.forEach(({ velocity }) => {
  const speed = Vec.length(velocity);

  assert.ok(speed >= 50 && speed <= 100, 'burst speed excludes body velocity');
});

physics.damage(
  { health: 0 } as import('../../src/client/types').Segment,
  1,
  [0, 0],
);

physics.damage(
  {
    health: 10,
    module: { unhurtWhen: 1 },
    active: 1,
  } as import('../../src/client/types').Segment,
  1,
  [0, 0],
);

assert.equal(physics.sparks.length, 8);
console.log('browser damage spark tests passed');

// Owner pruning must match exhaustive bounds queries across movement,
// removal and grid-cell changes.
{
  const tree = new physics.SpatialGrid();
  const owners = [{}, {}, {}, {}];
  const proxies = [];
  let seed = 17;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

  const box = () => {
    const bounds = new physics.AABB();

    Vec.setXY(bounds.lowerBound, random() * 500, random() * 500);
    Vec.add(
      bounds.lowerBound,
      Vec.create(5 + random() * 50, 5 + random() * 50),
      bounds.upperBound,
    );
    return bounds;
  };

  for (let tick = 0; tick < 500; tick++) {
    if (proxies.length > 80 && tick % 3 === 0) {
      tree.destroyProxy(proxies.shift());
    }

    proxies.push(tree.createProxy(box(), tick, owners[tick % owners.length]));

    if (tick % 2 === 0) {
      tree.moveProxy(
        proxies[Math.floor(random() * proxies.length)],
        box(),
        Vec.create(1, -2),
      );
    }

    const query = box();
    const owner = owners[tick % owners.length];

    const found: number[] = [];

    tree.query(
      query,
      (node) => {
        found.push(node.id);
        return true;
      },
      owner,
    );

    assert.deepEqual(
      found.sort((a, b) => a - b),
      proxies
        .filter(
          (node) =>
            node.owner !== owner && physics.AABB.testOverlap(node.aabb, query),
        )
        .map((node) => node.id)
        .sort((a, b) => a - b),
    );
  }
}

// Bounds reuse must make exactly the same proxy updates as full synchronization.
{
  const make = (cached: boolean) => {
    const world = new physics.PhysicsWorld();

    const body = world.createBody();
    const shape = new PolygonShape([
      Vec.create(-100, -1),
      Vec.create(100, -1),
      Vec.create(100, 1),
      Vec.create(-100, 1),
    ]);
    const fixture = body.createFixture(shape, {});

    body.createFixture(new physics.CircleShape(Vec.create(40, -20), 10), {});
    let calls = 0;
    const compute = shape.computeAABB.bind(shape);

    shape.computeAABB = (...args) => {
      calls++;
      return compute(...args);
    };

    if (cached) body.setProxyRadius(102);
    return { world, body, fixture, calls: () => calls };
  };

  const full = make(false);
  const cached = make(true);

  const compare = () => {
    let expected = full.body.m_fixtureList;
    let actual = cached.body.m_fixtureList;

    while (expected) {
      assert.deepEqual(actual.m_proxy.aabb, expected.m_proxy.aabb);
      expected = expected.m_next;
      actual = actual.m_next;
    }

    assert.deepEqual(
      cached.world.m_broadPhase.m_moveBuffer.map((node) => node?.id),
      full.world.m_broadPhase.m_moveBuffer.map((node) => node?.id),
    );
  };

  for (let tick = 0; tick < 4000; tick++) {
    const position = Vec.create(tick * 0.03, Math.sin(tick / 200));

    if (tick % 701 === 0) Vec.setXY(position, -tick, tick * 2);

    for (const { body, world } of [full, cached]) {
      world.m_broadPhase.m_moveBuffer.length = 0;
      body.setTransform(
        position,
        tick / 20000 + (Math.floor(tick / 1000) * Math.PI) / 2,
      );
      Vec.add(body.m_sweep.c, Vec.create(0.01, -0.01), body.m_sweep.c);
      body.m_sweep.a += tick % 503 === 0 ? 1 : 0.0001;
      body.synchronizeTransform();
      body.synchronizeFixtures();
    }

    compare();
  }

  assert(cached.calls() < full.calls() / 4);

  for (const { body } of [full, cached]) {
    body.createFixture(new physics.CircleShape(Vec.create(1000, 1000), 20), {});
    body.setTransform(Vec.create(200, 200), 0.3);
  }

  compare();
}

// Degenerate colliders do not shift user-data mappings for subsequent fixtures.
{
  const object = new GameObject({ id: 902, mass: 10, radius: 5 });

  const empty = {
    owner: object,
    position: object.position,
    rotation: 0,
    radius: 5,
    friction: 0,
    shapeOutline: [] as import('../../src/client/types').ShapeOutline,
  };

  const solid = {
    ...empty,
    shapeOutline: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
  };

  const collisions = new GameCollisions();

  object.hitbox = () => [empty, solid];

  for (let tick = 0; tick < 2; tick++) {
    collisions.step({
      entities: entityMap([object]),
      previous: new Map(),
      dt: 1 / 30,
    });

    assert.equal(collisions['bodies'].get(object.id).fixtures.length, 1);
    assert.equal(
      colliderOf(collisions['bodies'].get(object.id).fixtures[0]),
      solid,
    );
  }

  const fixture = collisions['bodies'].get(object.id).fixtures[0];

  empty.shapeOutline.push([0, 0], [1, 0]);

  collisions.step({
    entities: entityMap([object]),
    previous: new Map(),
    dt: 1 / 30,
  });

  assert.equal(
    collisions['bodies'].get(object.id).fixtures[0],
    fixture,
    'changing a degenerate collider must not rebuild unrelated fixtures',
  );
  empty.shapeOutline = [
    [-1, -1],
    [1, -1],
    [0, 1],
  ];

  collisions.step({
    entities: entityMap([object]),
    previous: new Map(),
    dt: 1 / 30,
  });

  assert.equal(collisions['bodies'].get(object.id).fixtures.length, 2);
}

// The body-local asteroid fast path still detects in-place segment edits.
{
  const world = createWorld();

  const asteroid = createAsteroid(world, {
    radius: 80,
    position: Vec.create(),
  });

  const collisions = new GameCollisions();

  const sync = () => {
    collisions.step({
      entities: entityMap([asteroid]),
      previous: new Map(),
      dt: 0,
    });

    return collisions['bodies'].get(asteroid.id).fixtures[0];
  };

  const original = sync();

  assert.equal(sync(), original);
  asteroid.friction = 0.75;
  assert.equal(sync(), original);
  assert.equal(colliderOf(original).friction, 0.75);
  asteroid.segments[0].shapeOutline[0][0] -= 0.5;
  const changed = sync();

  assert.notEqual(changed, original);
  assert.equal(sync(), changed);
  asteroid.position = Vec.create(123, 456);
  asteroid.segments[0].shapeOutline = asteroid.segments[0].shapeOutline.map(
    ([x, y]) => [x, y],
  );
  const restored = sync();

  assert.equal(colliderOf(restored).position, asteroid.position);
  assert.equal(
    colliderOf(restored).shapeOutline,
    asteroid.segments[0].shapeOutline,
  );
  assert.equal(colliderOf(restored).asteroidSegment, asteroid.segments[0]);
}

// Locked procedural vertices cannot silently invalidate cached fixtures. Health,
// material and pose remain live, and replacing list entries takes the checked path.
{
  const world = createWorld();

  const asteroid = createAsteroid(world, {
    radius: 40,
    pointCount: 7,
  }).lockGeometry();

  const source = asteroid.geometrySource;
  const colliders = asteroid.hitbox();
  const segment = asteroid.segments[0];

  assert(source);

  assert.throws(() => {
    segment.shapeOutline[0][0]++;
  }, TypeError);

  assert.throws(() => {
    segment.shapeOutline = [];
  }, TypeError);

  segment.health--;
  asteroid.friction = 0.7;
  asteroid.position = Vec.create(90, 50);
  asteroid.rotation = 0.8;
  assert.equal(asteroid.geometrySource, source);
  assert.equal(asteroid.hitbox(), colliders);
  assert.equal(colliders[0].friction, 0.7);
  assert.equal(colliders[0].position, asteroid.position);
  assert.equal(colliders[0].rotation, 0.8);
  const solver = new GameCollisions();

  // A lone parked asteroid defers geometry work; a neighbour keeps it awake.
  const neighbour = new GameObject({
    id: asteroid.id + 1,
    mass: 1,
    radius: 5,
    position: Vec.clone(asteroid.position),
  });

  const step = () =>
    solver.step({
      entities: entityMap([asteroid, neighbour]),
      previous: new Map(),
      dt: 1 / 60,
    });

  step();

  asteroid.segments[0] = {
    ...segment,
    shapeOutline: segment.shapeOutline.map((point) => [...point]),
  };

  asteroid.segments[0].shapeOutline[0][0] += 2;
  assert.equal(asteroid.geometrySource, undefined);
  step();
  assert(
    solver['bodies']
      .get(asteroid.id)
      .fixtures.some(
        (fixture) =>
          colliderOf(fixture).asteroidSegment === asteroid.segments[0],
      ),
  );
  asteroid.segments.pop();
  step();
  assert.equal(
    solver['bodies'].get(asteroid.id).fixtures.length,
    asteroid.segments.length,
  );
}

// Locked asteroid geometry still takes the detailed sync path when mass,
// inertia or a custom hitbox changes despite a stable geometry source.
{
  const asteroid = createAsteroid(createWorld(), {
    radius: 40,
    pointCount: 7,
  }).lockGeometry();

  const collisions = new GameCollisions();

  // A lone asteroid defers its fixtures; a neighbour keeps them built.
  const neighbour = new GameObject({
    id: asteroid.id + 1,
    mass: 1,
    radius: 5,
    position: Vec.create(45),
  });

  const step = () => {
    collisions.step({
      entities: entityMap([asteroid, neighbour]),
      previous: new Map(),
      dt: 0,
    });

    return collisions['bodies'].get(asteroid.id).fixtures[0];
  };

  const original = step();

  assert.notEqual(original, undefined);
  assert.equal(step(), original);
  asteroid.mass++;
  const changedMass = step();

  assert.notEqual(changedMass, original);
  assert.equal(step(), changedMass);
  asteroid.angularInertiaScale++;
  const changedInertia = step();

  assert.notEqual(changedInertia, changedMass);
  assert.equal(step(), changedInertia);
  const builtInHitbox = asteroid.hitbox.bind(asteroid);
  let customCalls = 0;

  asteroid.hitbox = () => {
    customCalls++;
    return builtInHitbox();
  };

  step();
  assert.equal(customCalls, 1, 'an overridden hitbox uses detailed sync');
}

// Cleanup removes departed IDs and replaces a body when an ID changes owner.
{
  const world = createWorld();
  const first = addEntity(
    world,
    new GameObject({ id: 2101, mass: 1, radius: 2, position: Vec.create() }),
  );
  const second = addEntity(
    world,
    new GameObject({ id: 2102, mass: 1, radius: 2, position: Vec.create(100) }),
  );
  const collisions = new GameCollisions();
  const step = () => collisions.step({ entities: world.entities, dt: 0 });

  step();
  assert.deepEqual([...collisions['bodies'].keys()], [first.id, second.id]);
  first.remove();
  step();
  assert.equal(collisions['bodies'].has(first.id), false);
  const oldBody = collisions['bodies'].get(second.id).body;

  const replacement = addEntity(
    world,
    new GameObject({
      id: second.id,
      mass: 2,
      radius: 3,
      position: Vec.create(200),
    }),
  );

  step();
  assert.equal(collisions['bodies'].get(second.id).entity, replacement);
  assert.notEqual(collisions['bodies'].get(second.id).body, oldBody);
  replacement.remove();
  step();
  assert.equal(collisions['bodies'].size, 0);
}

// A hitbox can add an entity, which must wait until the next collision step.
{
  const world = createWorld();
  const first = addEntity(
    world,
    new GameObject({ id: 2103, mass: 1, radius: 2, position: Vec.create() }),
  );

  const late = new GameObject({
    id: 2104,
    mass: 1,
    radius: 2,
    position: Vec.create(100),
  });

  const builtInHitbox = first.hitbox.bind(first);

  first.hitbox = () => {
    if (!world.entities.has(late.id)) addEntity(world, late);
    return builtInHitbox();
  };

  const collisions = new GameCollisions();

  collisions.step({ entities: world.entities, dt: 0 });
  assert.equal(world.entities.has(late.id), true);
  assert.deepEqual([...collisions['bodies'].keys()], [first.id]);
  collisions.step({ entities: world.entities, dt: 0 });
  assert.deepEqual([...collisions['bodies'].keys()], [first.id, late.id]);
}

// Deliberately collide two integer cell hashes: a bucket collision may add
// candidates, but must neither report a distant fixture nor lose one on removal.
{
  const grid = new physics.SpatialGrid();

  const box = (x: number, y: number) => {
    const bounds = new physics.AABB();

    Vec.setXY(bounds.lowerBound, x, y);
    Vec.setXY(bounds.upperBound, x + 5, y + 5);
    return bounds;
  };

  const near = grid.createProxy(box(64, 64), 'near', {});
  const far = grid.createProxy(
    box(320, Math.imul(1, 0x9e3779b1) * 256 + 64),
    'far',
    {},
  );

  const query = (
    bounds: import('../../src/client/collision/axis-aligned-bounds').AABB,
  ) => {
    const found: unknown[] = [];

    grid.query(bounds, (node) => {
      found.push(node.userData);
      return true;
    });

    return found;
  };

  assert.deepEqual(query(near.aabb), ['near']);
  assert.equal(
    grid['gridCells'].size,
    1,
    'the two occupied cells intentionally share a hash',
  );
  grid.destroyProxy(near);
  assert.deepEqual(query(far.aabb), ['far']);
}

// Circle center replacement remains visible to distance and bounds queries.
{
  const circle = new physics.CircleShape(Vec.create(5, 6), 3);

  circle.m_p = Vec.create(7, 8);
  assert.deepEqual(circle.getVertex(0), Vec.create(7, 8));
  assert.equal(circle.getSupport(Vec.create(1, 0)), 0);
}

// Reused GJK scratch must not carry state from overlapping polygons into a
// separated pair, or from a two/three-point simplex into a point query.
{
  const {
    computeDistance,
    DistanceInput,
    DistanceOutput,
    SimplexCache,
    matrix,
    CircleShape,
    PolygonShape,
  } = physics;
  const cache = new SimplexCache();
  const output = new DistanceOutput();
  let seed = 731;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const box = (x: number, y: number) =>
    new PolygonShape([
      Vec.create(-x, -y),
      Vec.create(x, -y),
      Vec.create(x, y),
      Vec.create(-x, y),
    ]);

  const queries = Array.from({ length: 500 }, (_, i) => {
    const ax = i % 3 ? 1 + random() * 20 : 0;
    const ay = ax ? 1 + random() * 20 : 0;
    const bx = i % 4 ? 1 + random() * 20 : 0;
    const by = bx ? 1 + random() * 20 : 0;
    const x = (random() - 0.5) * 80,
      y = (random() - 0.5) * 80;
    const input = new DistanceInput(
      matrix.transform(0, 0, 0),
      matrix.transform(x, y, 0),
    );

    input.proxyA = ax ? box(ax, ay) : new CircleShape(Vec.create(), 2);
    input.proxyB = bx ? box(bx, by) : new CircleShape(Vec.create(), 3);

    return {
      input,
      expected: Math.hypot(
        Math.max(0, Math.abs(x) - ax - bx),
        Math.max(0, Math.abs(y) - ay - by),
      ),
    };
  });

  for (const query of [...queries, ...queries.toReversed(), ...queries]) {
    cache.recycle();
    computeDistance(output, cache, query.input);
    assert.ok(
      Math.abs(output.distance - query.expected) < 1e-9,
      'GJK matches independent rectangle/point distance regardless of earlier queries',
    );
  }
}

// Cached reference rounding preserves the existing geometry tolerance in both
// directions, and refreshes after rebuilding fixtures.
{
  const object = new GameObject({
    id: 1901,
    mass: 10,
    shapeOutline: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
  });

  const collisions = new GameCollisions();

  const sync = () => {
    collisions.step({
      entities: entityMap([object]),
      previous: new Map(),
      dt: 0,
    });

    return collisions['bodies'].get(object.id).fixtures[0];
  };

  let fixture = sync();

  for (const [index, sign] of [
    [0, -1],
    [1, 1],
  ]) {
    object.shapeOutline[index][0] = sign * 2.0000004;
    assert.equal(sync(), fixture, 'sub-tolerance changes reuse the fixture');
    object.shapeOutline[index][0] = sign * 2.0000006;
    const changed = sync();

    assert.notEqual(
      changed,
      fixture,
      'crossing the rounding boundary rebuilds',
    );
    assert.equal(sync(), changed, 'the rebuilt signature is cached');
    fixture = changed;
  }

  object.mass++;
  const changedMass = sync();

  assert.notEqual(changedMass, fixture);
  assert.equal(sync(), changedMass);
  object.angularInertiaScale *= 2;
  assert.notEqual(sync(), changedMass);
}

// Craft geometry caching retains live materials and detects shape, membership,
// docking and explicit collision-margin changes.
{
  const world = createWorld();
  const ship = createPlayerShip(world, { position: Vec.create() });
  const collisions = new GameCollisions();

  const sync = () => {
    collisions.step({
      entities: entityMap([ship]),
      previous: new Map(),
      dt: 0,
    });

    return collisions['bodies'].get(ship.id).fixtures;
  };

  const index = sync().findIndex((fixture) => colliderOf(fixture).segment.hull);
  const original = sync()[index];

  ship.position = Vec.create(100, 200);
  ship.rotation = 0.3;
  ship.friction = 0.75;
  assert.equal(sync()[index], original);
  assert.equal(colliderOf(original).friction, 0.75);
  const segment = colliderOf(original).segment;

  assert(Array.isArray(segment.points));
  segment.points = segment.points.map((point) => [...point]);
  segment.points[0][0] += 1;
  const changed = sync()[index];

  assert.notEqual(changed, original);
  assert.equal(sync()[index], changed);
  segment.localPosition.x += 2;
  assert.notEqual(sync()[index], changed);
  segment.collider.collisionMargin = 0.125;
  assert.equal(sync()[index].getShape().m_radius, 0.125);
  ship.dockedTo = 123;
  assert.equal(sync().length, 0);
  ship.dockedTo = undefined;
  assert(sync().length > 0);
  ship.physics = false;
  assert.equal(sync().length, 0);
  ship.physics = true;
  assert(sync().length > 0);
}

// An isolated asteroid parks without fixtures, then builds them and stops an
// object that sweeps into it, including across a single fast step.
{
  const world = createWorld();

  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      radius: 60,
      position: Vec.create(),
    }).lockGeometry(),
  );

  const probe = addEntity(
    world,
    new GameObject({
      position: Vec.create(-400, 0),
      velocity: Vec.create(3000, 0),
      radius: 5,
      mass: 5,
      drag: 0,
    }),
  );

  const collisions = new GameCollisions();

  collisions.step({ entities: world.entities, previous: new Map(), dt: 0 });
  assert.equal(collisions['bodies'].get(asteroid.id).fixtures.length, 0);

  for (let tick = 0; tick < 10; tick++) {
    collisions.capturePoses(world.entities);
    world.entities.forEach((entity) => entity.update(1 / 30));
    collisions.step({ entities: world.entities, dt: 1 / 30 });
  }

  assert(collisions['bodies'].get(asteroid.id).fixtures.length > 0);
  assert(probe.position.x < 0, 'the swept probe does not pass through');
}
