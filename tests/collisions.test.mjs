/* global Buffer, process */

import './audio-context.mjs';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

globalThis.canvas = { getContext: () => ({}) };
globalThis.location = { search: '' };
globalThis.Path2D = class {
  arc() {}
  closePath() {}
  lineTo() {}
  moveTo() {}
};

const bundle = await rolldown({
  input: 'physics',
  plugins: [
    {
      name: 'physics-test-entry',
      load: (id) =>
        id === '\0physics'
          ? `
      export { detectCollisions } from '${process.cwd()}/src/shared/collision/detect-collisions.ts';
      export { contactBetween } from '${process.cwd()}/src/shared/collision/contact-between.ts';
      export { outerEdges } from '${process.cwd()}/src/shared/polygon.ts';
      export { GameCollisions } from '${process.cwd()}/src/shared/collision/game-collisions.ts';
      export { GameObject } from '${process.cwd()}/src/shared/game-object.ts';
      export { Module } from '${process.cwd()}/src/shared/modules/module.ts';
      export { addEntity, addPlayer, createWorld, entityId } from '${process.cwd()}/src/shared/simulation/world.ts';
      export { createShip } from '${process.cwd()}/src/shared/craft/create-ship.ts';
      export { Diamond } from '${process.cwd()}/src/shared/items/diamond.ts';
      export { createAsteroid } from '${process.cwd()}/src/shared/simulation/asteroid.ts';
      export { updateWorld } from '${process.cwd()}/src/shared/simulation/update-world.ts';
      export { captureWorld, restoreWorld } from '${process.cwd()}/src/shared/simulation/world-state.ts';
      export { controlShip } from '${process.cwd()}/src/shared/craft/control-ship.ts';
      export { simulationStep } from '${process.cwd()}/src/shared/settings.ts';
      export { sparks, sprayDamage } from '${process.cwd()}/src/client/shrapnel.ts';
      export { damage } from '${process.cwd()}/src/shared/craft/damage.ts';
      export { Vector } from '${process.cwd()}/src/shared/vector.ts';
      export { PolygonShape } from '${process.cwd()}/src/shared/collision/shape/polygon-shape.ts';
      export { ShieldGenerator } from '${process.cwd()}/src/shared/modules/shield-generator.ts';
      export { movePoint, rotatePoint } from '${process.cwd()}/src/shared/geometry.ts';
    `
          : undefined,
      resolveId: (id) => (id === 'physics' ? '\0physics' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });
const physics = await import(
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
  createShip,
  Diamond,
  createAsteroid,
  updateWorld,
  controlShip,
  simulationStep,
  captureWorld,
  restoreWorld,
  rotatePoint,
  Vector,
  PolygonShape,
  ShieldGenerator,
} = physics;

const closeTo = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const polygon = (outline, properties = {}) => ({
  outline,
  position: Vector(),
  radius: 20,
  rotation: 0,
  ...properties,
});
const body = ({ id, mass, position = Vector(), velocity = Vector() }) => ({
  hitbox: () => [],
  id,
  kind: 'item',
  mass,
  position,
  radius: 1,
  rotation: 0,
  spin: 0,
  update: () => {},
  velocity,
});

// Geometry helpers return full vectors, so callers can keep calculating with
// their results without wrapping or copying them first.
const turned = rotatePoint(Vector(2), Math.PI / 2);
const moved = movePoint(turned, 0, 3);

closeTo(turned.x, 0);
closeTo(turned.y, 2);
closeTo(moved.x, 3);
closeTo(moved.y, 2);
assert.equal(typeof moved.normalize, 'function');

// Circle-circle and circle-face contacts have exact penetration and normals.
let contact = contactBetween(
  { radius: 5, position: Vector() },
  { radius: 5, position: Vector(8) },
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
  { radius: 5, position: Vector(14) },
);
closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);

// A compound pentagon is tested by its convex parts. At an outside vertex its
// response normal is radial, never either internal seam normal.
const corners = Array.from({ length: 5 }, (_, index) => [
  Math.cos((index * Math.PI * 2) / 5) * 10,
  Math.sin((index * Math.PI * 2) / 5) * 10,
]);
const colliders = corners.map((corner, index) => ({
  outline: [[0, 0], corner, corners[(index + 1) % corners.length]],
}));

outerEdges(colliders.map(({ outline }) => outline));
const compound = polygon(
  [
    [100, 100],
    [101, 100],
    [100, 101],
  ],
  { colliders, radius: 10 },
);

contact = contactBetween(compound, { radius: 5, position: Vector(14) });
closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);
assert.ok(colliders.includes(contact.aCollider));

const owner = body({ id: 1, mass: 1 });
const otherOwner = body({ id: 2, mass: 1 });
const collider = { ...compound, owner, rotation: 0 };
const circle = {
  owner: otherOwner,
  radius: 5,
  position: Vector(14),
  rotation: 0,
};

owner.hitbox = () => [collider];
otherOwner.hitbox = () => [
  circle,
  {
    ...circle,
    owner,
    position: Vector(
      14 * Math.cos((Math.PI * 2) / 5),
      14 * Math.sin((Math.PI * 2) / 5),
    ),
  },
];
const contacts = detectCollisions({ entities: [owner, otherOwner] });

assert.equal(contacts.length, 1);
assert.ok(
  colliders.some(
    ({ outline }) =>
      outline === contacts[0].collider.outline ||
      outline === contacts[0].other.outline,
  ),
);

// Loose cargo modules have no shape, even when many leave a wreck at once.
{
  const modules = Array.from(
    { length: 12 },
    (_, index) => new Module({ id: 11000 + index }),
  );
  const contacts = new GameCollisions().step({
    entities: modules,
    previous: new Map(),
    dt: 1 / 30,
  });

  assert.equal(contacts.length, 0);
}

// Object mass is independent of geometry; only physical shapes set spin resistance.
assert.equal(new GameObject().mass, 6);
{
  const object = new GameObject({ id: 90, mass: 10, radius: 0 });

  object.angularInertiaScale = 3;
  object.hitbox = () => [
    {
      owner: object,
      position: Vector(),
      rotation: 0,
      radius: 2,
      friction: 0.01,
    },
    {
      owner: object,
      position: Vector(6),
      rotation: 0,
      radius: 1,
      friction: 0.01,
    },
    {
      owner: object,
      position: Vector(100),
      rotation: 0,
      radius: 20,
      friction: 0.01,
      physics: false,
    },
  ];
  const collisions = new GameCollisions();

  collisions.step({ entities: [object], previous: new Map(), dt: 1 / 30 });
  const solverBody = collisions.bodies.get(object.id).body;

  closeTo(solverBody.m_invMass, 1 / 10);
  closeTo(solverBody.m_invI, 1 / (10 * 8.9 * 3));

  object.hitbox = () => [
    {
      owner: object,
      position: Vector(5),
      rotation: 0,
      radius: 0,
      outline: [
        [-2, -1],
        [2, -1],
        [2, 1],
        [-2, 1],
      ],
      friction: 0.01,
    },
  ];
  collisions.step({ entities: [object], previous: new Map(), dt: 1 / 30 });
  closeTo(collisions.bodies.get(object.id).body.m_invI, 1 / 800);

  object.mass = 100;
  collisions.step({ entities: [object], previous: new Map(), dt: 1 / 30 });
  closeTo(collisions.bodies.get(object.id).body.m_invMass, 1 / 100);
  closeTo(collisions.bodies.get(object.id).body.m_invI, 1 / 8000);
}

// Off-centre impacts exchange angular as well as linear momentum.
const triangle = new GameObject({
  id: 10,
  mass: 200,
  radius: 30,
  outline: [
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
  position: Vector(15, -20),
  velocity: Vector(0, 200),
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
  position: triangle.position.add(Vector()),
  spin: triangle.spin,
};

restoreWorld({ world: torqueWorld, state: beforeImpact });

for (let i = 0; i < 20; i++) {
  updateWorld({ world: torqueWorld, inputs: new Map() });
}
closeTo(triangle.position.distanceTo(impactResult.position), 0, 1e-7);
closeTo(triangle.spin, impactResult.spin, 1e-7);

// A fast ship damages the contacted asteroid segment, not the whole body's health.
{
  const world = createWorld();
  const ship = addEntity(
    world,
    createShip(world, {
      playerId: 1,
      position: Vector(-85, 22.5),
      velocity: Vector(400),
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
  const events = [];

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
  const outline = Array.from({ length: count }, (_, index) => {
    const angle = (index * Math.PI * 2) / count;

    return [Math.cos(angle) * 20, Math.sin(angle) * 20];
  });
  const shape = new PolygonShape(outline.map(([x, y]) => Vector(x, y)));

  assert.equal(
    shape.m_count,
    count,
    `the ${count}-point hull is not truncated`,
  );

  const mover = new GameObject({
    id: 600 + count,
    mass: 6,
    radius: 0.5,
    position: Vector(180),
  });
  const obstacle = new GameObject({
    id: 700 + count,
    mass: 1e9,
    position: Vector(90),
    outline,
  });
  const contacts = new GameCollisions().step({
    entities: [mover, obstacle],
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vector(), rotation: 0 }]]),
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
    position: Vector(-50),
    velocity: Vector(6000),
    drag: 0,
    maxSpeed: 10000,
  }),
);
const wall = addEntity(
  ccdWorld,
  new GameObject({
    mass: 100000,
    radius: 30,
    outline: [
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
    position: Vector(50),
    velocity: Vector(1500),
    bounciness: 0.5,
  });
  const faces = [-10, 10].map(
    (x, index) =>
      new GameObject({
        id: 36 + index,
        radius: 1,
        mass: 1e9,
        position: Vector(x),
        bounciness: 0.5,
      }),
  );
  const contacts = new GameCollisions().step({
    entities: [mover, ...faces],
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vector(), rotation: 0 }]]),
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
    position: Vector(20),
    outline: [
      [-0.25, -20],
      [0.25, -20],
      [0.25, 20],
      [-0.25, 20],
    ],
  });
  const contacts = new GameCollisions().step({
    entities: [target, movingWall],
    dt: 1 / 30,
    previous: new Map([
      [movingWall.id, { position: Vector(-20), rotation: 0 }],
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
    position: Vector(travel),
  });
  const face = new GameObject({
    id: 91 + travel,
    mass: 1e9,
    position: Vector(90),
    outline: [
      [-0.25, -20],
      [0.25, -20],
      [0.25, 20],
      [-0.25, 20],
    ],
  });
  const contacts = new GameCollisions().step({
    entities: [mover, face],
    dt: 1 / 30,
    previous: new Map([[mover.id, { position: Vector(), rotation: 0 }]]),
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
  const makeMover = (id) =>
    new GameObject({ id, mass: 6, radius: 0.5, position: Vector(400) });
  const baseline = makeMover(496);
  const crossing = makeMover(497);
  const trigger = new GameObject({ id: 498, position: Vector(90), radius: 1 });

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
  const previous = (mover) =>
    new Map([[mover.id, { position: Vector(), rotation: 0 }]]);

  new GameCollisions().step({
    entities: [baseline],
    dt: 1 / 30,
    previous: previous(baseline),
  });
  const contacts = new GameCollisions().step({
    entities: [crossing, trigger],
    dt: 1 / 30,
    previous: previous(crossing),
  });

  assert(contacts.length > 0, 'the fast crossing reaches the trigger');
  closeTo(crossing.position.x, baseline.position.x);
  closeTo(crossing.velocity.x, baseline.velocity.x);
}

// Fixture synchronisation must rebuild changing outlines and discard the old
// broad-phase proxy when the outline shrinks again.
{
  const obstacle = new GameObject({
    id: 500,
    position: Vector(),
    outline: [
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
    position: Vector(8),
  });
  const collisions = new GameCollisions();
  const step = () =>
    collisions.step({
      entities: [obstacle, target],
      dt: 1 / 30,
      previous: new Map(),
    });

  assert.equal(step().length, 0);
  obstacle.outline = [
    [-1, -5],
    [10, -5],
    [10, 5],
    [-1, 5],
  ];
  assert(step().length > 0, 'a grown outline acquires a contact');
  obstacle.outline = [
    [-1, -5],
    [1, -5],
    [1, 5],
    [-1, 5],
  ];
  assert.equal(step().length, 0, 'a shrunk outline releases its contact');
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
  position: Vector(5),
});
const distantTarget = new GameObject({
  id: 42,
  mass: 10,
  radius: 2,
  position: Vector(15000),
});
const triggerContacts = new GameCollisions().step({
  entities: [trigger, triggerTarget, distantTarget],
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
  position: Vector(25),
});
const continuousContacts = new GameCollisions().step({
  entities: [trigger, fastTriggerTarget],
  dt: 1 / 60,
  previous: new Map([
    [fastTriggerTarget.id, { position: Vector(-25), rotation: 0 }],
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
  const ship = addEntity(world, createShip(world, { playerId: 7 }));
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
    new Diamond({
      world,
      id: entityId(world),
      position: Vector(mouth.position.x - 25, crossingY),
    }),
  );
  const crossingContacts = new GameCollisions().step({
    entities: [ship, item],
    previous: new Map([
      [
        item.id,
        { position: Vector(mouth.position.x + 25, crossingY), rotation: 0 },
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
  const events = [];

  ship.handleContacts({
    contacts: crossingContacts,
    events,
    world,
    dt: 1 / 30,
  });
  assert(ship.cargoContents.includes(item), 'the crossing item enters cargo');
  assert(
    item.position.distanceTo(mouth.position) > mouth.radius,
    'pickup occurs even though the item ends the tick beyond the mouth',
  );
  assert(events.some(({ type }) => type === 'itemCollected'));
}

const swinging = new GameObject({
  id: 42,
  mass: 100,
  radius: 51,
  rotation: Math.PI / 2,
  outline: [
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
  position: Vector(35.35, 35.35),
});
const angularContacts = new GameCollisions().step({
  entities: [swinging, struck],
  dt: 1 / 60,
  previous: new Map([[swinging.id, { position: Vector(), rotation: 0 }]]),
});

assert(
  angularContacts.length > 0 && struck.velocity.length() > 0,
  'a thin rotating solid sweeps and pushes the item',
);

// Nested colliders inherit material values, while an explicit zero removes
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
      colliders: [{ radius: 5 }],
    },
  ];
  const other = new GameObject({
    id: 47,
    mass: 9,
    radius: 5,
    position: Vector(9),
    friction: 0.25,
    bounciness: 3,
  });
  const solver = new GameCollisions();
  const contacts = solver.step({
    entities: [parent, other],
    dt: 1 / 30,
    previous: new Map([[other.id, { position: Vector(9.5), rotation: 0 }]]),
  });
  const contact = solver.world.m_contactList;

  assert(contacts.length, 'the nested physical collider contacts its target');
  assert.equal(contact.getFriction(), 0, 'explicit zero friction wins the mix');
  closeTo(contact.getRestitution(), 1.3);
  assert.equal(contact.getFixtureA().getUserData().friction, 0);
  assert.equal(contact.getFixtureA().getUserData().bounciness, -0.4);
}

// Low-speed contact keeps the existing bounce threshold with positive friction.
{
  const first = new GameObject({ id: 48, mass: 9, radius: 5 });
  const second = new GameObject({
    id: 49,
    mass: 9,
    radius: 5,
    position: Vector(9),
    friction: 0.25,
    bounciness: 3,
  });
  const solver = new GameCollisions();

  solver.step({
    entities: [first, second],
    dt: 1 / 30,
    previous: new Map([[second.id, { position: Vector(9.1), rotation: 0 }]]),
  });
  const contact = solver.world.m_contactList;

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
    position: Vector(9),
    friction: 0.25,
  });
  const solver = new GameCollisions();
  const step = () =>
    solver.step({ entities: [first, second], dt: 0, previous: new Map() });

  step();
  const fixture = solver.world.m_contactList.getFixtureA();

  closeTo(solver.world.m_contactList.getFriction(), 0.25);
  first.friction = 0;
  step();
  assert.equal(solver.world.m_contactList.getFixtureA(), fixture);
  assert.equal(solver.world.m_contactList.getFriction(), 0);
}

// Preserve the earlier hull/shield pair response under averaged material
// contributions, as well as mass-weighted push.
const bounce = (bounciness) => {
  const world = createWorld();
  const moving = addEntity(
    world,
    new GameObject({
      mass: 9,
      radius: 5,
      velocity: Vector(100),
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
      position: Vector(14),
      bounciness: 0.1,
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  for (let i = 0; i < 6; i++) updateWorld({ world: world, inputs: new Map() });
  closeTo(
    moving.mass * moving.velocity.x + heavy.mass * heavy.velocity.x,
    900,
    1e-7,
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
  const ship = addEntity(world, createShip(world));
  const shield = new ShieldGenerator();

  ship.cargoContents.push(shield);
  ship.fit(shield);
  ship.setModuleActive({ module: ShieldGenerator, active: true });
  const item = addEntity(
    world,
    new Diamond({ world, id: entityId(world), position: Vector(54) }),
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
      position: Vector(200, 300),
    }),
  );
  const children = asteroid.detach({
    asteroidSegment: asteroid.segments[0],
    world,
  });
  const leaf = children[0];
  const visualOutline = JSON.stringify(leaf.outline);

  leaf.hitbox()[0].outline.forEach(([x, y], index) => {
    closeTo(Vector(x, y).distanceTo(Vector(...leaf.outline[index])), 0.1);
  });
  const positions = children.map((child) => child.position.add(Vector()));

  children.forEach((child) => {
    child.velocity.set(Vector());
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
    closeTo(child.position.distanceTo(positions[index]), 0, 1e-8);
    closeTo(child.spin, 0, 1e-8);
  });
  assert.equal(
    JSON.stringify(leaf.outline),
    visualOutline,
    'collision clearance does not alter the rendered chunk',
  );
}

// In unobstructed flight the solver must not replace steering or drag.
const flightWorld = createWorld();
const flying = addEntity(flightWorld, createShip(flightWorld, { playerId: 1 }));

addPlayer(flightWorld, { id: 1, shipId: flying.id });
const referenceWorld = createWorld();
const reference = createShip(referenceWorld, { playerId: 1 });

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
  closeTo(flying.position.distanceTo(reference.position), 0, 1e-7);
  closeTo(flying.velocity.distanceTo(reference.velocity), 0, 1e-7);
  closeTo(flying.rotation, reference.rotation, 1e-9);
}

// Recorded against pre-Planck commit 6adcc82, holding left/right for five seconds
// then releasing. The 60 Hz integrator keeps the acceleration/braking curve;
// allow half of the old/new step difference in integrated angle, not slower steering.
for (const direction of [-1, 1]) {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

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
    closeTo(ship.spin, referenceSpin);

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

const offCentreStrike = ({ angularInertiaScale }) => {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  if (angularInertiaScale !== undefined) {
    ship.angularInertiaScale = angularInertiaScale;
  }
  addPlayer(world, { id: 1, shipId: ship.id });
  addEntity(
    world,
    new GameObject({
      position: Vector(-70, -25),
      velocity: Vector(150),
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
  new Diamond({
    world: driftWorld,
    id: entityId(driftWorld),
    velocity: Vector(150),
  }),
);
const driftReferenceWorld = createWorld();
const referenceItem = new Diamond({
  world: driftReferenceWorld,
  id: entityId(driftReferenceWorld),
  velocity: Vector(150),
});

for (let tick = 0; tick < 2200; tick++) {
  referenceItem.update(1 / 60);
  referenceItem.update(1 / 60);
  updateWorld({ world: driftWorld, inputs: new Map() });
  closeTo(drifting.position.distanceTo(referenceItem.position), 0, 1e-7);
  closeTo(drifting.velocity.distanceTo(referenceItem.velocity), 0, 1e-7);
}
assert.equal(drifting.velocity.length(), 0);
console.log(
  'Planck CCD, angular response, shield bounce, original steering and drift passed',
);

// Browser-only damage still emits each surface colour at the impact point;
// presentation remains outside the headless resolver.
const damagedHull = { health: 10, shades: ['dark', 'fill', '#f00'] };
const damagedRock = { health: 10 };

physics.sparks.length = 0;
physics.damage(damagedHull, 2, [7, 3]);
physics.damage({ ...damagedRock, stroke: '#abc' }, 2, [7, 3]);
assert.equal(
  physics.sparks.length,
  0,
  'shared damage never creates cosmetic objects',
);
physics.sprayDamage({ position: Vector(7, 3), color: '#f00', damage: 2 });
physics.sprayDamage({ position: Vector(7, 3), color: '#abc', damage: 2 });
assert.deepEqual(
  physics.sparks.map(({ position, color }) => [position.x, position.y, color]),
  [...Array(4).fill([7, 3, '#f00']), ...Array(4).fill([7, 3, '#abc'])],
);
physics.sparks.forEach(({ velocity }) => {
  const speed = velocity.length();

  assert.ok(speed >= 50 && speed <= 100, 'burst speed excludes body velocity');
});
physics.damage({ health: 0 }, 1, [0, 0]);
physics.damage(
  { health: 10, module: { unhurtWhen: true }, active: true },
  1,
  [0, 0],
);
assert.equal(physics.sparks.length, 8);
console.log('browser damage spark tests passed');
