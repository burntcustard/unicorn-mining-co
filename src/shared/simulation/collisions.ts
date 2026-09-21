import { type Entity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { Vector } from '../../vector';
import { asteroidContact } from './asteroid';

const bounciness = 0.1;

export const resolveCollision = (
  a: Entity,
  b: Entity,
  events: SimulationEvent[],
) => {
  const offset = b.position.subtract(a.position);
  const distance = offset.length();

  // Radii only bound the shapes, so they are no more than a first sift.
  if (distance >= a.radius + b.radius) return;

  // Polygon-to-circle contact is available when exactly one body is an
  // asteroid. Two asteroids use their circular bounds until the simulation has
  // a polygon-to-polygon contact solver.
  let rock;

  if (a.kind === 'asteroid' && b.kind !== 'asteroid') rock = a;
  else if (b.kind === 'asteroid' && a.kind !== 'asteroid') rock = b;
  let normal;
  let overlap;

  if (rock) {
    const other = rock === a ? b : a;
    const contact = asteroidContact({
      asteroid: rock,
      position: other.position,
      radius: other.radius,
    });

    if (!contact) return;
    overlap = contact.overlap;
    normal = rock === a ? contact.normal : contact.normal.scale(-1);
  } else {
    overlap = a.radius + b.radius - distance;
    normal = distance
      ? offset.normalize(distance)
      : Vector(a.id < b.id ? 1 : -1, 0);
  }

  const aMass = a.mass > 0 ? 1 / a.mass : 0;
  const bMass = b.mass > 0 ? 1 / b.mass : 0;
  const total = aMass + bMass;
  const drillingAsteroid =
    (a.kind === 'ship' && a.drill && b.kind === 'asteroid') ||
    (b.kind === 'ship' && b.drill && a.kind === 'asteroid');

  if (!total) return;

  const closing = b.velocity.subtract(a.velocity).dot(normal);

  if (closing < 0) {
    const impulse =
      (-closing * (1 + (drillingAsteroid ? 0 : bounciness))) / total;

    a.velocity.set(a.velocity.subtract(normal.scale(impulse * aMass)));
    b.velocity.set(b.velocity.add(normal.scale(impulse * bMass)));
  }

  const correction = Math.min(Math.max(overlap - 0.5, 0) * 0.4, 12) / total;

  a.position.set(a.position.subtract(normal.scale(correction * aMass)));
  b.position.set(b.position.add(normal.scale(correction * bMass)));
  events.push({ a: a.id, b: b.id, type: 'collision' });
};
