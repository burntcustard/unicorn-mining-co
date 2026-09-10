/* global Buffer, process */

import './audio-context.mjs';
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
      export { sparks } from '${process.cwd()}/src/shrapnel.js';
      export { damage } from '${process.cwd()}/src/ship.js';
      export { mine, grind } from '${process.cwd()}/src/mining.js';
      export { resolve } from '${process.cwd()}/src/resolve.js';
      export { Vector, movePoint, rotatePoint } from '${process.cwd()}/src/vector.js';
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
assert.equal(shipSegment.health, 10);

// Impact damage is based on closing speed and the other body's mass. A slow
// nudge into a heavy station is harmless, while a faster impact rounds to a
// whole point of hull damage.
const station = { mass: 1500, position: vector(14, 0), velocity: vector() };
ship.velocity.x = 20;
shipSegment.health = 10;
resolve([{
  collider: { owner: ship, segment: shipSegment }, depth: 1,
  other: { owner: station }, x: 1, y: 0,
}]);
assert.equal(shipSegment.health, 10);

ship.velocity.x = 272;
resolve([{
  collider: { owner: ship, segment: shipSegment }, depth: 1,
  other: { owner: station }, x: 1, y: 0,
}]);
assert.equal(shipSegment.health, 8);

// Light objects stay harmless below a whole point of rounded impact damage,
// but can dent either side of a contact at higher speeds.
for (const reverse of [false, true]) {
  for (const [speed, expectedHealth] of [[272, 10], [400, 9]]) {
    const hull = { health: 10, module: 0 };
    const pilot = { cockpit: true, mass: 9, position: vector(), velocity: vector(speed, 0) };
    const item = { mass: 6, position: vector(14, 0), velocity: vector() };
    const pilotCollider = { owner: pilot, segment: hull };
    const itemCollider = { owner: item };

    resolve([{
      collider: reverse ? itemCollider : pilotCollider,
      other: reverse ? pilotCollider : itemCollider,
      depth: 1, x: reverse ? -1 : 1, y: 0,
    }]);
    closeTo(hull.health, expectedHealth);
  }
}

// A negative restitution is the drill's grip signal, added to the other
// body's bounce rather than overriding it. It softens the rebound to a
// fraction of the closing speed rather than stopping it dead.
ship.velocity.x = 100;
rock.velocity.x = 0;
resolve([{
  collider: { bounciness: -0.2, owner: ship, segment: shipSegment },
  depth: 1,
  other: { bounciness: 0.1, owner: rock },
  x: 1,
  y: 0,
}]);
assert.ok(rock.velocity.x - ship.velocity.x < 0);
assert.ok(rock.velocity.x - ship.velocity.x > -20);

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
  bounciness: -0.2,
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

// Damage on both sides emits each surface colour at the same impact point.
const damagedHull = { health: 10, shades: ['dark', 'fill', '#f00'] };
const damagedRock = { health: 10 };
const impactShip = { mass: 9, position: vector(), velocity: vector(272, 0) };
const impactRock = { mass: 1500, position: vector(14, 0), velocity: vector() };
physics.sparks.length = 0;
resolve([{
  collider: { owner: impactShip, segment: damagedHull },
  other: { owner: impactRock, segment: damagedRock, stroke: '#abc' },
  depth: 1, x: 1, y: 0, point: [7, 3],
}]);
assert.equal(damagedHull.health, 8);
assert.equal(damagedRock.health, 8);
assert.deepEqual(physics.sparks.map(({ x, y, color }) => [x, y, color]),
  [...Array(4).fill([7, 3, '#f00']), ...Array(4).fill([7, 3, '#abc'])]);
physics.sparks.forEach(({ dx, dy }) => {
  const speed = Math.hypot(dx, dy);

  assert.ok(speed >= 50 && speed <= 100, 'burst speed excludes body velocity');
});
physics.damage({ health: 0 }, 1, [0, 0]);
physics.damage({ health: 10, module: { unhurtWhen: true }, active: true }, 1, [0, 0]);
assert.equal(physics.sparks.length, 8, 'dead and invulnerable objects do not spark');

// Mining retains the tip coordinates and uses the target's fallback fill.
const minedItem = { health: 10, fill: '#456', position: physics.Vector(20), velocity: vector() };
const drill = { module: { grinds: true, damage: 0.5 }, activationProgress: 1 };
physics.mine([{
  collider: { segment: drill, owner: impactShip, physics: false, x: 12, y: 4 },
  other: minedItem, depth: 1,
}]).forEach(physics.grind);
assert.equal(minedItem.health, 9.5);
assert.deepEqual(physics.sparks.slice(8).map(({ x, y, color }) => [x, y, color]), [[12, 4, '#456']]);

// The circle surface contact faces the other body, including reversed order.
const smallCircle = polygon(undefined, { radius: 2, x: 9 });
const largeCircle = polygon(undefined, { radius: 8 });
assert.deepEqual(hit(smallCircle, largeCircle).point, [7, 0]);
assert.deepEqual(hit(largeCircle, smallCircle).point, [7, 0]);
console.log('damage spark tests passed');

physics.sparks.length = 0;
physics.damage({ health: 100, fill: '#789' }, 50, [1, 2]);
assert.equal(physics.sparks.length, 100, 'large hits emit two sparks per damage point without a cap');
physics.damage({ health: 100, fill: '#789' }, 0, [1, 2]);
assert.equal(physics.sparks.length, 100, 'zero damage emits no sparks');
