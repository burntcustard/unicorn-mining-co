import { linearSlop } from '../../specs/physics';
import { Manifold, WorldManifold } from '../collision/contact-manifold';
import { PolygonShape } from '../collision/shape/polygon-shape';
import * as Vec from '../utilities/vector';
import * as matrix from '../utilities/vector-math';
import { type Body } from './body';
import { type Fixture } from './fixture';
import { type Contact } from './contact';
import { type World } from './world';

// Ignore roundoff at the boundary of a recovery; clearance remains a full linearSlop.
const recoveryTolerance = 1e-8;

type Slab = { normal: Vec.Value; lowerBound: number; upperBound: number };

const axesOf = (fixture: Fixture, axes: Vec.Value[], count: number) => {
  const shape = fixture.m_shape;

  if (shape instanceof PolygonShape) {
    for (const normal of shape.m_normals) {
      matrix.rotateInto(
        (axes[count] ??= Vec.create()),
        fixture.m_body.m_xf.q,
        normal,
      );
      count++;
    }
  }

  return count;
};

type Projection = { lowerBound: number; upperBound: number };

const project = (
  fixture: Fixture,
  normal: Vec.Value,
  origin: Vec.Value,
  result: Projection,
  axis: Vec.Value,
) => {
  const { m_shape: shape, m_body: body } = fixture;

  matrix.unrotateInto(axis, body.m_xf.q, normal);
  const offset =
    (body.m_xf.p.x - origin.x) * normal.x +
    (body.m_xf.p.y - origin.y) * normal.y;
  let lowerBound = Infinity;
  let upperBound = -Infinity;

  for (const vertex of shape.m_vertices) {
    const value = Vec.dot(vertex, axis) + offset;

    lowerBound = Math.min(lowerBound, value);
    upperBound = Math.max(upperBound, value);
  }

  result.lowerBound = lowerBound - shape.m_radius;
  result.upperBound = upperBound + shape.m_radius;
};

const clipInterval = (
  { normal, lowerBound, upperBound }: Slab,
  direction: Vec.Value,
  result: Projection,
) => {
  const speed = Vec.dot(normal, direction);

  if (Math.abs(speed) < 1e-10) {
    if (lowerBound >= -recoveryTolerance || upperBound <= recoveryTolerance) {
      return false;
    }
  } else {
    const t0 = lowerBound / speed;
    const t1 = upperBound / speed;

    result.lowerBound = Math.max(result.lowerBound, Math.min(t0, t1));
    result.upperBound = Math.min(result.upperBound, Math.max(t0, t1));
  }

  return result.upperBound > 0 && result.lowerBound < result.upperBound;
};

const intervalFor = (
  slabs: Slab[],
  count: number,
  direction: Vec.Value,
  result: Projection,
) => {
  result.lowerBound = -Infinity;
  result.upperBound = Infinity;

  for (let index = 0; index < count; index++) {
    if (!clipInterval(slabs[index], direction, result)) return false;
  }

  return true;
};

const escapeDistance = (intervals: number[][]) => {
  intervals.sort((a, b) => a[0] - b[0]);
  let distance = 0;

  for (const [entry, exit] of intervals) {
    if (entry > distance + recoveryTolerance) break;
    distance = Math.max(distance, exit);
  }

  return distance;
};

/*
 * Ordinary position constraints allow a little penetration. Recover only when
 * that solver leaves a deeper overlap, including containment and opposing jaws.
 * Each fixture pair describes a convex forbidden region for translation of the
 * entire body. Search rays through their union instead of canceling opposing
 * contact normals. Extra circle axes conservatively bound curved corners.
 */
export const recoverOverlaps = (world: World) => {
  const candidates = new Set<Body>();
  const manifold = new Manifold();

  const result = new WorldManifold();

  const embedded = (contact: Contact) => {
    const a = contact.m_fixtureA;
    const b = contact.m_fixtureB;

    if (
      !contact.isEnabled() ||
      !a.m_physics ||
      !b.m_physics ||
      (!a.m_body.m_invMass && !b.m_body.m_invMass) ||
      !a.shouldCollide(b)
    ) {
      return false;
    }

    contact.evaluate(manifold, a.m_body.m_xf, b.m_body.m_xf);

    if (!manifold.pointCount) return false;
    manifold.getWorldManifold(
      result,
      a.m_body.m_xf,
      a.m_shape.m_radius,
      b.m_body.m_xf,
      b.m_shape.m_radius,
    );

    return (
      result.separations[0] < -3 * linearSlop - recoveryTolerance ||
      (result.pointCount > 1 &&
        result.separations[1] < -3 * linearSlop - recoveryTolerance)
    );
  };

  for (let contact = world.m_contactList; contact; contact = contact.m_next) {
    if (!embedded(contact)) continue;
    const a = contact.m_fixtureA;
    const b = contact.m_fixtureB;
    const body = a.m_body.m_invMass >= b.m_body.m_invMass ? a.m_body : b.m_body;

    if (body.m_invMass > 0) candidates.add(body);
  }

  for (const body of candidates) {
    // An earlier recovery may already have freed this body.
    let trapped = false;

    for (let edge = body.m_contactList; edge; edge = edge.next) {
      if (embedded(edge.contact)) {
        trapped = true;
        break;
      }
    }

    if (!trapped) continue;

    const directions = Array.from({ length: 16 }, (_, index) => {
      const angle = body.getAngle() + (index * Math.PI) / 8;

      return Vec.create(Math.cos(angle), Math.sin(angle));
    });

    const origin = body.m_xf.p;
    const axes: Vec.Value[] = [];
    const temporary: Slab[] = [];
    const intervals: number[][] = [];
    const aProjection = { lowerBound: 0, upperBound: 0 };
    const bProjection = { lowerBound: 0, upperBound: 0 };
    const interval = { lowerBound: 0, upperBound: 0 };
    const axis = Vec.create();

    // The first ray includes every pair and bounds the rest of the search.
    // Reuse projections and axes instead of allocating them for every pair.
    const pairSlabs = (a: Fixture, b: Fixture, limit: number) => {
      let count = axesOf(b, axes, axesOf(a, axes, 0));

      if (a.m_shape.m_type === 'circle' || b.m_shape.m_type === 'circle') {
        for (let index = 0; index < 16; index++) {
          Vec.set((axes[count] ??= Vec.create()), directions[index]);
          count++;
        }
      }

      interval.lowerBound = -Infinity;
      interval.upperBound = Infinity;

      for (let index = 0; index < count; index++) {
        const normal = axes[index];

        project(a, normal, origin, aProjection, axis);
        project(b, normal, origin, bProjection, axis);
        const lowerBound =
          bProjection.lowerBound - aProjection.upperBound - linearSlop;
        const upperBound =
          bProjection.upperBound - aProjection.lowerBound + linearSlop;

        const slab = (temporary[index] ??= {
          normal: Vec.create(),
          lowerBound: 0,
          upperBound: 0,
        });

        Vec.set(slab.normal, normal);
        slab.lowerBound = lowerBound;
        slab.upperBound = upperBound;

        if (limit === Infinity) {
          // A pair missing this ray cannot contain its origin either.
          if (!clipInterval(slab, directions[0], interval)) return 0;
        } else {
          const extent = limit * Math.hypot(normal.x, normal.y);

          // Exclude only slabs outside the disk of every better escape.
          if (lowerBound > extent || upperBound < -extent) return 0;
        }
      }

      return count;
    };

    for (let other = world.m_bodyList; other; other = other.m_next) {
      if (other === body) continue;

      for (let a = body.m_fixtureList; a; a = a.m_next) {
        if (!a.m_physics) continue;

        for (let b = other.m_fixtureList; b; b = b.m_next) {
          if (!b.m_physics || !a.shouldCollide(b)) continue;
          const count = pairSlabs(a, b, Infinity);

          if (!count) continue;
          let contains = true;

          for (let index = 0; index < count; index++) {
            const { lowerBound, upperBound } = temporary[index];

            contains &&=
              lowerBound < -recoveryTolerance && upperBound > recoveryTolerance;
          }

          if (contains) {
            for (let index = 0; index < count; index++) {
              const { normal } = temporary[index];

              directions.push(Vec.clone(normal), Vec.scale(normal, -1));
            }
          }

          if (intervalFor(temporary, count, directions[0], interval)) {
            intervals.push([interval.lowerBound, interval.upperBound]);
          }
        }
      }
    }

    let best = escapeDistance(intervals);
    let escape = Number.isFinite(best)
      ? Vec.scale(directions[0], best)
      : Vec.create();
    const maxDirectionLength = directions.reduce(
      (length, direction) =>
        Math.max(length, Math.hypot(direction.x, direction.y)),
      0,
    );
    const limit =
      (best + recoveryTolerance) * maxDirectionLength + recoveryTolerance;
    const obstacles: Slab[][] = [];

    for (let other = world.m_bodyList; other; other = other.m_next) {
      if (other === body) continue;

      for (let a = body.m_fixtureList; a; a = a.m_next) {
        if (!a.m_physics) continue;

        for (let b = other.m_fixtureList; b; b = b.m_next) {
          if (!b.m_physics || !a.shouldCollide(b)) continue;
          const count = pairSlabs(a, b, limit);

          if (count) {
            obstacles.push(
              temporary.slice(0, count).map((slab) => ({
                ...slab,
                normal: Vec.clone(slab.normal),
              })),
            );
          }
        }
      }
    }

    for (const direction of directions.slice(1)) {
      intervals.length = 0;

      for (const slabs of obstacles) {
        if (intervalFor(slabs, slabs.length, direction, interval)) {
          intervals.push([interval.lowerBound, interval.upperBound]);
        }
      }

      const distance = escapeDistance(intervals);

      if (distance < best - recoveryTolerance) {
        best = distance;
        escape = Vec.scale(direction, distance);
      }
    }

    // Recovery changes position only; it must not manufacture impact velocity.
    if (best > 0 && Number.isFinite(best)) {
      body.setTransform(Vec.add(origin, escape), body.getAngle());
    }
  }

  if (candidates.size) world.findNewContacts();
};
