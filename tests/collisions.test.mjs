/* global Buffer, process */

import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

globalThis.z = { getContext: () => ({}) };
globalThis.location = { search: '' };
globalThis.Path2D = class {
  arc() {}
  closePath() {}
  lineTo() {}
  moveTo() {}
};

const bundle = await rolldown({
  input: 'physics',
  plugins: [{
    name: 'physics-test-entry',
    load: (id) => id === '\0physics' ?
      `
      export { detectCollisions, hit, outerEdges } from '${process.cwd()}/src/collisions.js';
      export { resolve } from '${process.cwd()}/src/resolve.js';
      export { movePoint, rotatePoint } from '${process.cwd()}/src/vector.js';
    ` :
      undefined,
    resolveId: (id) => id === 'physics' ? '\0physics' : undefined,
  }],
});
const { output } = await bundle.generate({ format: 'esm' });
const physics = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
const { detectCollisions, hit, movePoint, outerEdges, resolve, rotatePoint } = physics;

const closeTo = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const polygon = (outline, properties = {}) => ({
  outline,
  radius: 20,
  rotation: 0,
  x: 0,
  y: 0,
  ...properties,
});
const vector = (x = 0, y = 0) => ({
  x,
  y,
  add(other) {
    return vector(this.x + other.x, this.y + other.y);
  },
  dot(other) {
    return this.x * other.x + this.y * other.y;
  },
  scale(amount) {
    return vector(this.x * amount, this.y * amount);
  },
  set(other) {
    this.x = other.x;
    this.y = other.y;
  },
  subtract(other) {
    return vector(this.x - other.x, this.y - other.y);
  },
});

// Geometry helpers return full vectors, so callers can continue calculating
// with their results without wrapping or copying them first.
const turned = rotatePoint({ x: 2, y: 0 }, Math.PI / 2);
const moved = movePoint(turned, 0, 3);

closeTo(turned.x, 0);
closeTo(turned.y, 2);
closeTo(moved.x, 3);
closeTo(moved.y, 2);
assert.equal(typeof moved.normalize, 'function');

// Circle-circle and circle-face contacts have exact penetration and normals.
let contact = hit({ radius: 5, x: 0, y: 0 }, { radius: 5, x: 8, y: 0 });

closeTo(contact.depth, 2);
closeTo(contact.x, 1);
closeTo(contact.y, 0);

contact = hit(polygon([[-10, -10], [10, -10], [10, 10], [-10, 10]]), {
  radius: 5,
  x: 14,
  y: 0,
});
closeTo(contact.depth, 1);
closeTo(contact.x, 1);
closeTo(contact.y, 0);

// A compound pentagon is tested by its triangles. At a point its normal is
// radial, not either neighboring face normal, including after body rotation.
const corners = Array.from({ length: 5 }, (_, i) => [
  Math.cos(i * Math.PI * 2 / 5) * 10,
  Math.sin(i * Math.PI * 2 / 5) * 10,
]);
const parts = corners.map((corner, i) => ({
  outline: [[0, 0], corner, corners[(i + 1) % corners.length]],
}));

outerEdges(parts.map(({ outline }) => outline));
const asteroid = polygon([[100, 100], [101, 100], [100, 101]], {
  parts,
  radius: 10,
});

contact = hit(asteroid, { radius: 5, x: 14, y: 0 });
closeTo(contact.depth, 1);
closeTo(contact.x, 1);
closeTo(contact.y, 0);
assert.ok(parts.includes(contact.aPart));

contact = hit({ radius: 5, x: 14, y: 0 }, asteroid);
closeTo(contact.depth, 1);
closeTo(contact.x, -1);
closeTo(contact.y, 0);
assert.ok(parts.includes(contact.bPart));

const rotated = { ...asteroid, rotation: Math.PI / 3, shapePass: -1 };

contact = hit(rotated, {
  radius: 5,
  x: 14 * Math.cos(rotated.rotation),
  y: 14 * Math.sin(rotated.rotation),
});
closeTo(contact.x, Math.cos(rotated.rotation));
closeTo(contact.y, Math.sin(rotated.rotation));

// The broad phase reports the actual convex part and excludes a shared owner.
const owner = { mass: 1 };
const hitbox = { ...asteroid, owner, rotation: 0 };
const circle = { radius: 5, x: 14, y: 0 };
const contacts = detectCollisions([
  { hitboxes: () => [hitbox] },
  { hitboxes: () => [circle, {
    ...circle,
    owner,
    x: 14 * Math.cos(Math.PI * 2 / 5),
    y: 14 * Math.sin(Math.PI * 2 / 5),
  }] },
]);

assert.equal(contacts.length, 1);
assert.ok(parts.includes(contacts[0].collider.segment || contacts[0].other.segment));

// The impulse conserves linear momentum and makes the normal speeds separate;
// the lighter shield body therefore takes most of the bounce.
const ship = { cockpit: true, mass: 9, position: vector(), velocity: vector(100, 0) };
const rock = { mass: 200, position: vector(14, 0), velocity: vector() };
const shipSegment = { health: 10, module: 0 };
const beforeMomentum = ship.mass * ship.velocity.x + rock.mass * rock.velocity.x;

resolve([{
  collider: { bounciness: 0.4, owner: ship, segment: shipSegment },
  depth: 1,
  other: { bounciness: 0.1, owner: rock },
  x: 1,
  y: 0,
}]);
closeTo(ship.mass * ship.velocity.x + rock.mass * rock.velocity.x, beforeMomentum);
assert.ok(ship.velocity.x < 0);
assert.ok(rock.velocity.x > 0);
assert.ok(rock.velocity.x - ship.velocity.x > 0);
assert.ok(shipSegment.health < 10);

// A negative restitution is the drill's grip signal. It must override the
// other body's bounce without leaving any velocity travelling into the face.
ship.velocity.x = 100;
rock.velocity.x = 0;
resolve([{
  collider: { bounciness: -1, owner: ship, segment: shipSegment },
  depth: 1,
  other: { bounciness: 0.1, owner: rock },
  x: 1,
  y: 0,
}]);
closeTo(rock.velocity.x - ship.velocity.x, 0);

// Continuous thrust cannot carry a gripping triangular horn through a hull
// made from convex pieces, even where its point is aimed at the shared seam.
const drillingShip = { mass: 9, position: vector(), velocity: vector() };
const fixedHull = { mass: 0, position: vector(10, 0), velocity: vector() };
const hullOutline = [[-2, -6], [2, -6], [2, 6], [-2, 6]];
const hullParts = [
  { outline: [hullOutline[0], hullOutline[1], hullOutline[2]] },
  { outline: [hullOutline[0], hullOutline[2], hullOutline[3]] },
];

outerEdges(hullParts.map(({ outline }) => outline));
const horn = {
  bounciness: -1,
  outline: [[0, -2], [6, 0], [0, 2]],
  owner: drillingShip,
  radius: 6,
  rotation: 0,
  segment: { module: 0 },
};
const hull = {
  outline: hullOutline,
  owner: fixedHull,
  parts: hullParts,
  radius: 7,
  rotation: 0,
  x: 10,
  y: 0,
};
const hornSprite = { hitboxes: () => [Object.assign(horn, drillingShip.position)] };
const hullSprite = { hitboxes: () => [hull] };

for (let frame = 120; frame--;) {
  drillingShip.velocity.x += 1;
  drillingShip.position.x += drillingShip.velocity.x / 60;
  resolve(detectCollisions([hornSprite, hullSprite]));
}

assert.ok(drillingShip.position.x + 6 < 8.6);

console.log('collision and bounce tests passed');
