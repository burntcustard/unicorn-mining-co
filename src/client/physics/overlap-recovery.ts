import { linearSlop } from '../../specs/physics';
import { Manifold, WorldManifold } from '../collision/contact-manifold';
import { type Shape } from '../collision/shape/base';
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

const axesOf = (shape: Shape, body: Body) =>
  shape instanceof PolygonShape
    ? shape.m_normals.map((normal) =>
        matrix.rotateInto(Vec.create(), body.m_xf.q, normal),
      )
    : [];

const project = (fixture: Fixture, normal: Vec.Value, origin: Vec.Value) => {
  const { m_shape: shape, m_body: body } = fixture;
  const axis = matrix.unrotateInto(Vec.create(), body.m_xf.q, normal);
  const offset = Vec.dot(Vec.subtract(body.m_xf.p, origin), normal);
  let lowerBound = Infinity;
  let upperBound = -Infinity;

  for (const vertex of shape.m_vertices) {
    const value = Vec.dot(vertex, axis) + offset;

    lowerBound = Math.min(lowerBound, value);
    upperBound = Math.max(upperBound, value);
  }

  return [lowerBound - shape.m_radius, upperBound + shape.m_radius];
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

    const obstacles: Slab[][] = [];
    const origin = body.m_xf.p;

    for (let other = world.m_bodyList; other; other = other.m_next) {
      if (other === body) continue;

      for (let a = body.m_fixtureList; a; a = a.m_next) {
        if (!a.m_physics) continue;

        for (let b = other.m_fixtureList; b; b = b.m_next) {
          if (!b.m_physics || !a.shouldCollide(b)) continue;
          const axes = [
            ...axesOf(a.m_shape, body),
            ...axesOf(b.m_shape, other),
          ];

          if (a.m_shape.m_type === 'circle' || b.m_shape.m_type === 'circle') {
            axes.push(...directions.slice(0, 16));
          }

          const slabs = axes.map((normal) => {
            const [a0, a1] = project(a!, normal, origin);
            const [b0, b1] = project(b!, normal, origin);

            return {
              normal,
              lowerBound: b0 - a1 - linearSlop,
              upperBound: b1 - a0 + linearSlop,
            };
          });

          if (
            slabs.every(
              ({ lowerBound, upperBound }) =>
                lowerBound < -recoveryTolerance &&
                upperBound > recoveryTolerance,
            )
          ) {
            for (const { normal } of slabs) {
              directions.push(normal, Vec.scale(normal, -1));
            }
          }

          obstacles.push(slabs);
        }
      }
    }

    let best = Infinity;
    let escape = Vec.create();

    for (const direction of directions) {
      const intervals: number[][] = [];

      for (const slabs of obstacles) {
        let entry = -Infinity;
        let exit = Infinity;

        for (const { normal, lowerBound, upperBound } of slabs) {
          const speed = Vec.dot(normal, direction);

          if (Math.abs(speed) < 1e-10) {
            if (
              lowerBound >= -recoveryTolerance ||
              upperBound <= recoveryTolerance
            ) {
              exit = -Infinity;
              break;
            }
          } else {
            const t0 = lowerBound / speed;
            const t1 = upperBound / speed;

            entry = Math.max(entry, Math.min(t0, t1));
            exit = Math.min(exit, Math.max(t0, t1));
          }
        }

        if (exit > 0 && entry < exit) intervals.push([entry, exit]);
      }

      intervals.sort((a, b) => a[0] - b[0]);
      let distance = 0;

      for (const [entry, exit] of intervals) {
        if (entry > distance + recoveryTolerance) break;
        distance = Math.max(distance, exit);
      }

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
