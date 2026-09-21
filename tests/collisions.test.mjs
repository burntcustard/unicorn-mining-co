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
      export { detectCollisions, hit, outerEdges, resolve } from '${process.cwd()}/src/shared/simulation/collisions.ts';
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
  resolve,
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
closeTo(contact.depth, 1);
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
closeTo(contact.depth, 1);
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

// The shared resolver conserves linear momentum and sends the light body away
// with most of the bounce.
const ship = body({ id: 3, mass: 9, velocity: Vector(100) });
const rock = body({ id: 4, mass: 200, position: Vector(14) });
const beforeMomentum =
  ship.mass * ship.velocity.x + rock.mass * rock.velocity.x;

resolve({
  contacts: [
    {
      collider: {
        bounciness: 0.4,
        owner: ship,
        position: ship.position,
        radius: 5,
        rotation: 0,
      },
      depth: 1,
      normal: Vector(1),
      other: {
        bounciness: 0.1,
        owner: rock,
        position: rock.position,
        radius: 5,
        rotation: 0,
      },
      point: [7, 0],
    },
  ],
});
closeTo(
  ship.mass * ship.velocity.x + rock.mass * rock.velocity.x,
  beforeMomentum,
);
assert.ok(ship.velocity.x < 0);
assert.ok(rock.velocity.x > 0);

// Continuous thrust cannot carry a gripping triangular horn through a fixed
// hull, even where its point is aimed at a shared convex seam.
const drillingShip = body({ id: 5, mass: 9 });
const fixedHull = body({ id: 6, mass: 0, position: Vector(10) });
const hullOutline = [
  [-2, -6],
  [2, -6],
  [2, 6],
  [-2, 6],
];
const hullParts = [
  { outline: [hullOutline[0], hullOutline[1], hullOutline[2]] },
  { outline: [hullOutline[0], hullOutline[2], hullOutline[3]] },
];

outerEdges(hullParts.map(({ outline }) => outline));
drillingShip.hitboxes = () => [
  {
    bounciness: -0.2,
    outline: [
      [0, -2],
      [6, 0],
      [0, 2],
    ],
    owner: drillingShip,
    position: drillingShip.position,
    radius: 6,
    rotation: 0,
  },
];
fixedHull.hitboxes = () => [
  {
    outline: hullOutline,
    owner: fixedHull,
    parts: hullParts,
    position: fixedHull.position,
    radius: 7,
    rotation: 0,
  },
];

for (let frame = 120; frame--;) {
  drillingShip.velocity.x += 1;
  drillingShip.position.x += drillingShip.velocity.x / 60;
  resolve({
    contacts: detectCollisions({ entities: [drillingShip, fixedHull] }),
  });
}
assert.ok(drillingShip.position.x + 6 < 8.6);
console.log('shared collision and bounce tests passed');

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
