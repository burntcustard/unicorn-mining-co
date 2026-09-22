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
      export { detectCollisions } from '${process.cwd()}/src/shared/physics/collision/detect-collisions.ts';
      export { hit } from '${process.cwd()}/src/shared/physics/collision/hit.ts';
      export { outerEdges } from '${process.cwd()}/src/shared/physics/collision/outer-edges.ts';
      export { GamePhysics } from '${process.cwd()}/src/shared/physics/game-physics.ts';
      export { GameObject } from '${process.cwd()}/src/shared/game-object.ts';
      export * from '${process.cwd()}/src/shared/simulation/index.ts';
      export { controlShip } from '${process.cwd()}/src/shared/craft/control-ship.ts';
      export { simulationStep } from '${process.cwd()}/src/shared/simulation/update-tier.ts';
      export { sparks, sprayDamage } from '${process.cwd()}/src/client/shrapnel.ts';
      export { damage } from '${process.cwd()}/src/shared/craft/damage.ts';
      export { Vector } from '${process.cwd()}/src/shared/vector.ts';
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
  hit,
  movePoint,
  outerEdges,
  GamePhysics,
  GameObject,
  createWorld,
  addEntity,
  addPlayer,
  createShip,
  createItem,
  createAsteroid,
  updateWorld,
  controlShip,
  simulationStep,
  captureWorld,
  restoreWorld,
  rotatePoint,
  Vector,
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
  hitboxes: () => [],
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
let contact = hit(
  { radius: 5, position: Vector() },
  { radius: 5, position: Vector(8) },
);

closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);

contact = hit(
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
const parts = corners.map((corner, index) => ({
  outline: [[0, 0], corner, corners[(index + 1) % corners.length]],
}));

parts.forEach((part) => (part.part = part));
outerEdges(parts.map(({ outline }) => outline));
const compound = polygon(
  [
    [100, 100],
    [101, 100],
    [100, 101],
  ],
  { parts, radius: 10 },
);

contact = hit(compound, { radius: 5, position: Vector(14) });
closeTo(contact.depth, 2);
closeTo(contact.normal.x, 1);
closeTo(contact.normal.y, 0);
assert.ok(parts.includes(contact.aPart));

const owner = body({ id: 1, mass: 1 });
const otherOwner = body({ id: 2, mass: 1 });
const hitbox = { ...compound, owner, rotation: 0 };
const circle = {
  owner: otherOwner,
  radius: 5,
  position: Vector(14),
  rotation: 0,
};

owner.hitboxes = () => [hitbox];
otherOwner.hitboxes = () => [
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
assert.ok(parts.includes(contacts[0].collider.part || contacts[0].other.part));

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
for (let i = 0; i < 20; i++)
  updateWorld({ world: torqueWorld, inputs: new Map() });
assert(
  Math.abs(triangle.spin) > 0.01,
  'pushing a triangular tip rotates the rock',
);
const impactResult = {
  position: triangle.position.add(Vector()),
  spin: triangle.spin,
};
restoreWorld({ world: torqueWorld, state: beforeImpact });
for (let i = 0; i < 20; i++)
  updateWorld({ world: torqueWorld, inputs: new Map() });
closeTo(triangle.position.distanceTo(impactResult.position), 0, 1e-7);
closeTo(triangle.spin, impactResult.spin, 1e-7);

// A fast ship damages the contacted asteroid section, not the whole body's health.
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
      points: 5,
      contents: [0, 1, 2, 3],
    }),
  );
  const health = rock.health;
  const events = [];
  for (let tick = 0; tick < 60; tick++)
    events.push(...updateWorld({ world: world, inputs: new Map() }));
  assert.equal(
    rock.health,
    health,
    'impact damage belongs to the struck section',
  );
  assert(
    events.some(({ type }) => type === 'asteroidSplit'),
    'a broken impact section splits off without a drill',
  );
  assert.deepEqual(
    [...world.entities.values()]
      .flatMap((entity) => entity.contents || [])
      .sort((a, b) => a - b),
    [0, 1, 2, 3],
  );
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

// A sensor attached to a rotating body must sweep its arc, not a straight ray.
const rotating = new GameObject({
  id: 40,
  mass: 6,
  radius: 52,
  rotation: Math.PI / 2,
});
rotating.hitboxes = () => [
  {
    owner: rotating,
    position: rotating.position.add(rotatePoint(Vector(50), rotating.rotation)),
    radius: 2,
    rotation: rotating.rotation,
    physics: false,
    role: 'drill',
  },
];
const sensorTarget = new GameObject({
  id: 41,
  mass: 100,
  radius: 2,
  position: Vector(35.35, 35.35),
});
const swept = new GamePhysics().step({
  entities: [rotating, sensorTarget],
  dt: 1 / 60,
  previous: new Map([[rotating.id, { position: Vector(), rotation: 0 }]]),
});
assert(
  swept.some(({ collider }) => collider.role === 'drill'),
  'rotational CCD catches the drill arc',
);

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
const angularContacts = new GamePhysics().step({
  entities: [swinging, struck],
  dt: 1 / 60,
  previous: new Map([[swinging.id, { position: Vector(), rotation: 0 }]]),
});
assert(
  angularContacts.length > 0 && struck.velocity.length() > 0,
  'a thin rotating solid sweeps and pushes the item',
);

// Preserve the additive hull/shield restitution rule and mass-weighted push.
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

// Once a section detaches, touching cut faces must not create an artificial
// separation impulse. Remove the intentional split drift to isolate the solver.
for (const radiusEven of [undefined, 25]) {
  const world = createWorld();
  const asteroid = addEntity(
    world,
    createAsteroid(world, {
      radius: 100,
      points: radiusEven ? 6 : 7,
      radiusEven,
      rotation: 0.4,
      position: Vector(200, 300),
    }),
  );
  const children = asteroid.detach({ section: asteroid.sections[0], world });
  const leaf = children[0];
  const visualOutline = JSON.stringify(leaf.outline);
  leaf.hitboxes()[0].outline.forEach(([x, y], index) => {
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
  for (let tick = 0; tick < 10; tick++)
    updateWorld({ world: world, inputs: new Map() });
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
    drill: false,
    hatch: false,
    light: false,
    shield: false,
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
            drill: false,
            hatch: false,
            light: false,
            shield: false,
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
    if (fullTurnTime === undefined && angle * direction >= 4 * Math.PI)
      fullTurnTime =
        (tick - 1) * simulationStep +
        ((4 * Math.PI - before * direction) / ((angle - before) * direction)) *
          simulationStep;
  }
  closeTo(fullTurnTime, 4.278419834415983, 1 / 120);
  closeTo(ship.spin, 0);
}

const offCentreStrike = ({ angularInertiaScale }) => {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  if (angularInertiaScale !== undefined)
    ship.angularInertiaScale = angularInertiaScale;
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
  createItem(driftWorld, { velocity: Vector(150), resource: 0 }),
);
const referenceItem = createItem(createWorld(), {
  velocity: Vector(150),
  resource: 0,
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
