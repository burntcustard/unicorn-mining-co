/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/dynamics/Contact.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/*
 * Planck.js
 *
 * Copyright (c) Erin Catto, Ali Shakiba
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as matrix from '../vector-math';
import { ShapeType } from '../collision/shape/base';
import { TransformValue } from '../vector-math';
import { contactSpeedThreshold, linearSlop } from '../settings';
import {
  Manifold,
  type ManifoldType,
  WorldManifold,
} from '../collision/contact-manifold';
import { Fixture } from './fixture';
import { Body } from './body';
import { Pool } from '../utilities/object-pool';
import { Vec2, type Vec2Value } from '../vector';

class Mat22 {
  ex = Vec2.zero();
  ey = Vec2.zero();
}

function getTransform(xf: TransformValue, c: Vec2Value, angle: number): void {
  xf.q.c = Math.cos(angle);
  xf.q.s = Math.sin(angle);
  matrix.copyVec2(xf.p, c);
}

const contactPool = new Pool<Contact>({
  create() {
    return new Contact();
  },
  release(contact: Contact) {
    contact.recycle();
  },
});

const worldManifold = new WorldManifold();

/**
 * A contact edge is used to connect bodies and contacts together in a contact
 * graph where each body is a node and each contact is an edge. A contact edge
 * belongs to a doubly linked list maintained in each attached body. Each
 * contact has two contact nodes, one for each attached body.
 */
export class ContactEdge {
  contact: Contact;
  prev: ContactEdge | null = null;
  next: ContactEdge | null = null;
  other: Body | null = null;
  constructor(contact: Contact) {
    this.contact = contact;
  }
  recycle() {
    this.prev = null;
    this.next = null;
    this.other = null;
  }
}

export type EvaluateFunction = (
  manifold: Manifold,
  xfA: TransformValue,
  fixtureA: Fixture,
  xfB: TransformValue,
  fixtureB: Fixture,
) => void;

const s_registers: Record<string, Record<string, EvaluateFunction>> = {};

export class VelocityConstraintPoint {
  rA = matrix.vec2(0, 0);
  rB = matrix.vec2(0, 0);
  normalImpulse = 0;
  tangentImpulse = 0;
  normalMass = 0;
  tangentMass = 0;
  velocityBias = 0;
}

const cA = matrix.vec2(0, 0);
const vA = matrix.vec2(0, 0);
const cB = matrix.vec2(0, 0);
const vB = matrix.vec2(0, 0);
const tangent = matrix.vec2(0, 0);
const xfA = matrix.transform(0, 0, 0);
const xfB = matrix.transform(0, 0, 0);
const pointA = matrix.vec2(0, 0);
const pointB = matrix.vec2(0, 0);
const clipPoint = matrix.vec2(0, 0);
const planePoint = matrix.vec2(0, 0);
const rA = matrix.vec2(0, 0);
const rB = matrix.vec2(0, 0);
const P = matrix.vec2(0, 0);
const normal = matrix.vec2(0, 0);
const point = matrix.vec2(0, 0);
const dv = matrix.vec2(0, 0);
const dv1 = matrix.vec2(0, 0);
const dv2 = matrix.vec2(0, 0);
const b = matrix.vec2(0, 0);
const a = matrix.vec2(0, 0);
const x = matrix.vec2(0, 0);
const d = matrix.vec2(0, 0);
const P1 = matrix.vec2(0, 0);
const P2 = matrix.vec2(0, 0);
const temp = matrix.vec2(0, 0);

/**
 * The class manages contact between two shapes. A contact exists for each
 * overlapping AABB in the broad-phase (except if filtered). Therefore a contact
 * object may exist that has no contact points.
 */
export class Contact {
  m_nodeA = new ContactEdge(this);
  m_nodeB = new ContactEdge(this);
  m_manifold: Manifold = new Manifold();
  v_normal = matrix.vec2(0, 0);
  v_normalMass: Mat22 = new Mat22();
  v_K: Mat22 = new Mat22();
  p_localPoints = [matrix.vec2(0, 0), matrix.vec2(0, 0)]; // [maxManifoldPoints];
  p_localNormal = matrix.vec2(0, 0);
  p_localPoint = matrix.vec2(0, 0);
  m_fixtureA: Fixture | null = null;
  m_fixtureB: Fixture | null = null;
  m_evaluateFcn: EvaluateFunction | null = null;
  m_prev: Contact | null = null;
  m_next: Contact | null = null;
  m_toi = 1;
  m_toiFlag = false;
  m_friction = 0;
  m_restitution = 0;
  m_surfaceSpeed = 0;
  v_pointCount = 0;
  invMassA = 0;
  invMassB = 0;
  invIA = 0;
  p_type: ManifoldType = undefined;
  p_radiusA = 0;
  p_radiusB = 0;
  p_pointCount = 0;
  // Nodes for connecting bodies.
  m_toiCount = 0;
  // This contact has a valid TOI in m_toi
  // This contact can be disabled (by user)
  m_enabledFlag = true;
  // Used when crawling contact graph when forming islands.
  m_islandFlag = false;
  // Set when the shapes are touching.
  m_touchingFlag = false;

  // VelocityConstraint
  v_points = [new VelocityConstraintPoint(), new VelocityConstraintPoint()]; // [maxManifoldPoints];
  invIB = 0;

  // PositionConstraint
  initialize(fA: Fixture, fB: Fixture, evaluateFcn: EvaluateFunction) {
    this.m_fixtureA = fA;
    this.m_fixtureB = fB;

    this.m_evaluateFcn = evaluateFcn;
  }
  recycle() {
    this.m_nodeA.recycle();
    this.m_nodeB.recycle();
    this.m_fixtureA = null;
    this.m_fixtureB = null;
    this.m_evaluateFcn = null;
    this.m_manifold.recycle();
    this.m_prev = null;
    this.m_next = null;
    this.m_toi = 1;
    this.m_toiCount = 0;
    this.m_toiFlag = false;
    this.m_friction = 0;
    this.m_restitution = 0;
    this.m_surfaceSpeed = 0;
    this.m_enabledFlag = true;
    this.m_islandFlag = false;
    this.m_touchingFlag = false;
    // Solver fields are refreshed by initConstraint before this contact is solved.
  }

  initConstraint(): void {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    const shapeA = fixtureA.m_shape;
    const shapeB = fixtureB.m_shape;

    const manifold = this.m_manifold;

    const pointCount = manifold.pointCount;

    this.invMassA = bodyA.m_invMass;
    this.invMassB = bodyB.m_invMass;
    this.invIA = bodyA.m_invI;
    this.invIB = bodyB.m_invI;

    this.v_pointCount = pointCount;

    this.p_radiusA = shapeA.m_radius;
    this.p_radiusB = shapeB.m_radius;

    this.p_type = manifold.type;
    matrix.copyVec2(this.p_localNormal, manifold.localNormal);
    matrix.copyVec2(this.p_localPoint, manifold.localPoint);
    this.p_pointCount = pointCount;

    for (let j = 0; j < pointCount; ++j) {
      const point = this.v_points[j];

      point.normalImpulse = 0;
      point.tangentImpulse = 0;
      matrix.copyVec2(this.p_localPoints[j], manifold.points[j].localPoint);
    }
  }

  /**
   * Get the world manifold.
   */
  getWorldManifold(
    worldManifold: WorldManifold | null,
  ): WorldManifold | undefined {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    const shapeA = fixtureA.m_shape;
    const shapeB = fixtureB.m_shape;

    return this.m_manifold.getWorldManifold(
      worldManifold,
      bodyA.getTransform(),
      shapeA.m_radius,
      bodyB.getTransform(),
      shapeB.m_radius,
    );
  }

  /**
   * Enable/disable this contact. This can be used inside the pre-solve contact
   * listener. The contact is only disabled for the current time step (or sub-step
   * in continuous collisions).
   */
  setEnabled(flag: boolean): void {
    this.m_enabledFlag = !!flag;
  }

  /**
   * Has this contact been disabled?
   */
  isEnabled(): boolean {
    return this.m_enabledFlag;
  }

  /**
   * Is this contact touching?
   */
  isTouching(): boolean {
    return this.m_touchingFlag;
  }

  /**
   * Get the next contact in the world's contact list.
   */
  getNext(): Contact | null {
    return this.m_next;
  }

  /**
   * Get fixture A in this contact.
   */
  getFixtureA(): Fixture {
    return this.m_fixtureA;
  }

  /**
   * Get fixture B in this contact.
   */
  getFixtureB(): Fixture {
    return this.m_fixtureB;
  }

  /**
   * Set contact friction before the solver builds velocity constraints.
   */
  setFriction(friction: number): void {
    this.m_friction = friction;
  }

  /**
   * Get the friction.
   */
  getFriction(): number {
    return this.m_friction;
  }

  /**
   * Set contact restitution before the solver builds velocity constraints.
   */
  setRestitution(restitution: number): void {
    this.m_restitution = restitution;
  }

  setSurfaceSpeed(speed: number): void {
    this.m_surfaceSpeed = speed;
  }

  /**
   * Get the restitution.
   */
  getRestitution(): number {
    return this.m_restitution;
  }

  /**
   * Called by Update method, and implemented by subclasses.
   */
  evaluate(manifold: Manifold, xfA: TransformValue, xfB: TransformValue): void {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    this.m_evaluateFcn(manifold, xfA, fixtureA, xfB, fixtureB);
  }

  /**
   * Updates the contact manifold and touching status.
   *
   * Note: do not assume the fixture AABBs are overlapping or are valid.
   *
   * @param listener.preSolve
   */
  update(listener?: { preSolve(contact: Contact): void }): void {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    // Re-enable this contact.
    this.m_enabledFlag = true;

    const xfA = bodyA.m_xf;
    const xfB = bodyB.m_xf;

    this.m_manifold.recycle();

    this.evaluate(this.m_manifold, xfA, xfB);
    const touching = this.m_manifold.pointCount > 0;

    this.m_touchingFlag = touching;

    if (touching) listener?.preSolve(this);
  }

  solvePositionConstraint(): number {
    return this._solvePositionConstraint(null, null);
  }

  solvePositionConstraintTOI(toiA: Body, toiB: Body): number {
    return this._solvePositionConstraint(toiA, toiB);
  }

  private _solvePositionConstraint(
    toiA: Body | null,
    toiB: Body | null,
  ): number {
    const toi = toiA !== null && toiB !== null;
    let minSeparation = 0;

    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    const positionA = bodyA.c_position;
    const positionB = bodyB.c_position;

    let mA = 0;
    let iA = 0;

    if (!toi || bodyA === toiA || bodyA === toiB) {
      mA = this.invMassA;
      iA = this.invIA;
    }

    let mB = 0;
    let iB = 0;

    if (!toi || bodyB === toiA || bodyB === toiB) {
      mB = this.invMassB;
      iB = this.invIB;
    }

    matrix.copyVec2(cA, positionA.c);
    let aA = positionA.a;

    matrix.copyVec2(cB, positionB.c);
    let aB = positionB.a;

    // Solve normal constraints
    for (let j = 0; j < this.p_pointCount; ++j) {
      getTransform(xfA, cA, aA);
      getTransform(xfB, cB, aB);

      // PositionSolverManifold
      let separation: number;

      switch (this.p_type) {
        case 'circles': {
          matrix.transformVec2(pointA, xfA, this.p_localPoint);
          matrix.transformVec2(pointB, xfB, this.p_localPoints[0]);
          matrix.subVec2(normal, pointB, pointA);
          matrix.normalizeVec2(normal);

          matrix.combine2Vec2(point, 0.5, pointA, 0.5, pointB);
          separation =
            matrix.dotVec2(pointB, normal) -
            matrix.dotVec2(pointA, normal) -
            this.p_radiusA -
            this.p_radiusB;
          break;
        }

        case 'faceA': {
          matrix.rotVec2(normal, xfA.q, this.p_localNormal);
          matrix.transformVec2(planePoint, xfA, this.p_localPoint);
          matrix.transformVec2(clipPoint, xfB, this.p_localPoints[j]);
          separation =
            matrix.dotVec2(clipPoint, normal) -
            matrix.dotVec2(planePoint, normal) -
            this.p_radiusA -
            this.p_radiusB;
          matrix.copyVec2(point, clipPoint);
          break;
        }

        case 'faceB': {
          matrix.rotVec2(normal, xfB.q, this.p_localNormal);
          matrix.transformVec2(planePoint, xfB, this.p_localPoint);
          matrix.transformVec2(clipPoint, xfA, this.p_localPoints[j]);
          separation =
            matrix.dotVec2(clipPoint, normal) -
            matrix.dotVec2(planePoint, normal) -
            this.p_radiusA -
            this.p_radiusB;
          matrix.copyVec2(point, clipPoint);

          // Ensure normal points from A to B
          matrix.negVec2(normal);
          break;
        }

        default: {
          return minSeparation;
        }
      }

      matrix.subVec2(rA, point, cA);
      matrix.subVec2(rB, point, cB);

      // Track max constraint error.
      minSeparation = Math.min(minSeparation, separation);

      const baumgarte = toi ? 0.75 : 0.2;
      const maxLinearCorrection = 20;

      // Prevent large corrections and allow slop.
      const C = Math.max(
        -maxLinearCorrection,
        Math.min(baumgarte * (separation + linearSlop), 0),
      );

      // Compute the effective mass.
      const rnA = matrix.crossVec2Vec2(rA, normal);
      const rnB = matrix.crossVec2Vec2(rB, normal);
      const K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;

      // Compute normal impulse
      const impulse = K > 0 ? -C / K : 0;

      matrix.scaleVec2(P, impulse, normal);

      matrix.minusScaleVec2(cA, mA, P);
      aA -= iA * matrix.crossVec2Vec2(rA, P);

      matrix.plusScaleVec2(cB, mB, P);
      aB += iB * matrix.crossVec2Vec2(rB, P);
    }

    matrix.copyVec2(positionA.c, cA);
    positionA.a = aA;

    matrix.copyVec2(positionB.c, cB);
    positionB.a = aB;

    return minSeparation;
  }

  initVelocityConstraint(): void {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    const velocityA = bodyA.c_velocity;
    const velocityB = bodyB.c_velocity;

    const positionA = bodyA.c_position;
    const positionB = bodyB.c_position;

    const radiusA = this.p_radiusA;
    const radiusB = this.p_radiusB;
    const manifold = this.m_manifold;

    const mA = this.invMassA;
    const mB = this.invMassB;
    const iA = this.invIA;
    const iB = this.invIB;

    matrix.copyVec2(cA, positionA.c);
    const aA = positionA.a;

    matrix.copyVec2(vA, velocityA.v);
    const wA = velocityA.w;

    matrix.copyVec2(cB, positionB.c);
    const aB = positionB.a;

    matrix.copyVec2(vB, velocityB.v);
    const wB = velocityB.w;

    getTransform(xfA, cA, aA);
    getTransform(xfB, cB, aB);

    worldManifold.recycle();
    manifold.getWorldManifold(worldManifold, xfA, radiusA, xfB, radiusB);

    matrix.copyVec2(this.v_normal, worldManifold.normal);

    for (let j = 0; j < this.v_pointCount; ++j) {
      const vcp = this.v_points[j]; // VelocityConstraintPoint
      const wmp = worldManifold.points[j];

      matrix.subVec2(vcp.rA, wmp, cA);
      matrix.subVec2(vcp.rB, wmp, cB);

      const rnA = matrix.crossVec2Vec2(vcp.rA, this.v_normal);
      const rnB = matrix.crossVec2Vec2(vcp.rB, this.v_normal);

      const kNormal = mA + mB + iA * rnA * rnA + iB * rnB * rnB;

      vcp.normalMass = 1 / kNormal;

      matrix.crossVec2Num(tangent, this.v_normal, 1);

      const rtA = matrix.crossVec2Vec2(vcp.rA, tangent);
      const rtB = matrix.crossVec2Vec2(vcp.rB, tangent);

      const kTangent = mA + mB + iA * rtA * rtA + iB * rtB * rtB;

      vcp.tangentMass = 1 / kTangent;

      // A growing surface separates bodies even when their centres are still.
      vcp.velocityBias = 0;
      let vRel = 0;

      vRel += matrix.dotVec2(this.v_normal, vB);
      vRel += matrix.dotVec2(
        this.v_normal,
        matrix.crossNumVec2(temp, wB, vcp.rB),
      );
      vRel -= matrix.dotVec2(this.v_normal, vA);
      vRel -= matrix.dotVec2(
        this.v_normal,
        matrix.crossNumVec2(temp, wA, vcp.rA),
      );

      if (this.m_surfaceSpeed) {
        vRel -= this.m_surfaceSpeed;
        vcp.velocityBias = this.m_surfaceSpeed;
      }

      if (vRel < -contactSpeedThreshold) {
        vcp.velocityBias -= this.m_restitution * vRel;
      }
    }

    // If we have two points, then prepare the block solver.
    if (this.v_pointCount === 2) {
      const vcp1 = this.v_points[0]; // VelocityConstraintPoint
      const vcp2 = this.v_points[1]; // VelocityConstraintPoint

      const rn1A = matrix.crossVec2Vec2(vcp1.rA, this.v_normal);
      const rn1B = matrix.crossVec2Vec2(vcp1.rB, this.v_normal);
      const rn2A = matrix.crossVec2Vec2(vcp2.rA, this.v_normal);
      const rn2B = matrix.crossVec2Vec2(vcp2.rB, this.v_normal);

      const k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
      const k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
      const k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;

      // Ensure a reasonable condition number.
      const k_maxConditionNumber = 1000;

      if (k11 * k11 < k_maxConditionNumber * (k11 * k22 - k12 * k12)) {
        // K is safe to invert.
        this.v_K.ex.setNum(k11, k12);
        this.v_K.ey.setNum(k12, k22);
        const a = this.v_K.ex.x;
        const b = this.v_K.ey.x;
        const c = this.v_K.ex.y;
        const d = this.v_K.ey.y;
        const det = 1 / (a * d - b * c);

        this.v_normalMass.ex.x = det * d;
        this.v_normalMass.ey.x = -det * b;
        this.v_normalMass.ex.y = -det * c;
        this.v_normalMass.ey.y = det * a;
      } else {
        // The constraints are redundant, just use one.
        this.v_pointCount = 1;
      }
    }

    matrix.copyVec2(positionA.c, cA);
    positionA.a = aA;
    matrix.copyVec2(velocityA.v, vA);
    velocityA.w = wA;

    matrix.copyVec2(positionB.c, cB);
    positionB.a = aB;
    matrix.copyVec2(velocityB.v, vB);
    velocityB.w = wB;
  }

  solveVelocityConstraint(): void {
    const fixtureA = this.m_fixtureA;
    const fixtureB = this.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    const velocityA = bodyA.c_velocity;

    const velocityB = bodyB.c_velocity;

    const mA = this.invMassA;
    const iA = this.invIA;
    const mB = this.invMassB;
    const iB = this.invIB;

    matrix.copyVec2(vA, velocityA.v);
    let wA = velocityA.w;

    matrix.copyVec2(vB, velocityB.v);
    let wB = velocityB.w;

    matrix.copyVec2(normal, this.v_normal);
    matrix.crossVec2Num(tangent, normal, 1);
    const friction = this.m_friction;

    // Solve tangent constraints first because non-penetration is more important
    // than friction.
    for (let j = 0; j < this.v_pointCount; ++j) {
      const vcp = this.v_points[j]; // VelocityConstraintPoint

      // Relative velocity at contact
      matrix.zeroVec2(dv);
      matrix.plusVec2(dv, vB);
      matrix.plusVec2(dv, matrix.crossNumVec2(temp, wB, vcp.rB));
      matrix.minusVec2(dv, vA);
      matrix.minusVec2(dv, matrix.crossNumVec2(temp, wA, vcp.rA));

      // Compute tangent force
      const vt = matrix.dotVec2(dv, tangent);
      let lambda = vcp.tangentMass * -vt;

      // Clamp the accumulated force
      const maxFriction = friction * vcp.normalImpulse;
      const newImpulse = Math.max(
        -maxFriction,
        Math.min(vcp.tangentImpulse + lambda, maxFriction),
      );

      lambda = newImpulse - vcp.tangentImpulse;
      vcp.tangentImpulse = newImpulse;

      // Apply contact impulse
      matrix.scaleVec2(P, lambda, tangent);

      matrix.minusScaleVec2(vA, mA, P);
      wA -= iA * matrix.crossVec2Vec2(vcp.rA, P);

      matrix.plusScaleVec2(vB, mB, P);
      wB += iB * matrix.crossVec2Vec2(vcp.rB, P);
    }

    // Solve normal constraints
    if (this.v_pointCount === 1) {
      for (let i = 0; i < this.v_pointCount; ++i) {
        const vcp = this.v_points[i]; // VelocityConstraintPoint

        // Relative velocity at contact
        matrix.zeroVec2(dv);
        matrix.plusVec2(dv, vB);
        matrix.plusVec2(dv, matrix.crossNumVec2(temp, wB, vcp.rB));
        matrix.minusVec2(dv, vA);
        matrix.minusVec2(dv, matrix.crossNumVec2(temp, wA, vcp.rA));

        // Compute normal impulse
        const vn = matrix.dotVec2(dv, normal);
        let lambda = -vcp.normalMass * (vn - vcp.velocityBias);

        // Clamp the accumulated impulse
        const newImpulse = Math.max(vcp.normalImpulse + lambda, 0);

        lambda = newImpulse - vcp.normalImpulse;
        vcp.normalImpulse = newImpulse;

        // Apply contact impulse
        matrix.scaleVec2(P, lambda, normal);

        matrix.minusScaleVec2(vA, mA, P);
        wA -= iA * matrix.crossVec2Vec2(vcp.rA, P);

        matrix.plusScaleVec2(vB, mB, P);
        wB += iB * matrix.crossVec2Vec2(vcp.rB, P);
      }
    } else {
      // Block solver developed in collaboration with Dirk Gregorius (back in
      // 01/07 on Box2D_Lite).
      // Build the mini LCP for this contact patch
      //
      // vn = A * x + b, vn >= 0, x >= 0 and vn_i * x_i = 0 with i = 1..2
      //
      // A = J * W * JT and J = ( -n, -r1 x n, n, r2 x n )
      // b = vn0 - velocityBias
      //
      // The system is solved using the "Total enumeration method" (s. Murty).
      // The complementary constraint vn_i * x_i
      // implies that we must have in any solution either vn_i = 0 or x_i = 0.
      // So for the 2D contact problem the cases
      // vn1 = 0 and vn2 = 0, x1 = 0 and x2 = 0, x1 = 0 and vn2 = 0, x2 = 0 and
      // vn1 = 0 need to be tested. The first valid
      // solution that satisfies the problem is chosen.
      //
      // In order to account of the accumulated impulse 'a' (because of the
      // iterative nature of the solver which only requires
      // that the accumulated impulse is clamped and not the incremental
      // impulse) we change the impulse variable (x_i).
      //
      // Substitute:
      //
      // x = a + d
      //
      // a := old total impulse
      // x := new total impulse
      // d := incremental impulse
      //
      // For the current iteration we extend the formula for the incremental
      // impulse
      // to compute the new total impulse:
      //
      // vn = A * d + b
      // = A * (x - a) + b
      // = A * x + b - A * a
      // = A * x + b'
      // b' = b - A * a

      const vcp1 = this.v_points[0]; // VelocityConstraintPoint
      const vcp2 = this.v_points[1]; // VelocityConstraintPoint

      matrix.setVec2(a, vcp1.normalImpulse, vcp2.normalImpulse);

      // Relative velocity at contact
      matrix.zeroVec2(dv1);
      matrix.plusVec2(dv1, vB);
      matrix.plusVec2(dv1, matrix.crossNumVec2(temp, wB, vcp1.rB));
      matrix.minusVec2(dv1, vA);
      matrix.minusVec2(dv1, matrix.crossNumVec2(temp, wA, vcp1.rA));

      matrix.zeroVec2(dv2);
      matrix.plusVec2(dv2, vB);
      matrix.plusVec2(dv2, matrix.crossNumVec2(temp, wB, vcp2.rB));
      matrix.minusVec2(dv2, vA);
      matrix.minusVec2(dv2, matrix.crossNumVec2(temp, wA, vcp2.rA));

      // Compute normal velocity
      let vn1 = matrix.dotVec2(dv1, normal);
      let vn2 = matrix.dotVec2(dv2, normal);

      matrix.setVec2(b, vn1 - vcp1.velocityBias, vn2 - vcp2.velocityBias);

      // Compute b'
      b.x -= this.v_K.ex.x * a.x + this.v_K.ey.x * a.y;
      b.y -= this.v_K.ex.y * a.x + this.v_K.ey.y * a.y;

      while (true) {
        //
        // Case 1: vn = 0
        //
        // 0 = A * x + b'
        //
        // Solve for x:
        //
        // x = - inv(A) * b'
        //
        matrix.zeroVec2(x);
        x.x = -(this.v_normalMass.ex.x * b.x + this.v_normalMass.ey.x * b.y);
        x.y = -(this.v_normalMass.ex.y * b.x + this.v_normalMass.ey.y * b.y);

        if (x.x >= 0 && x.y >= 0) {
          // Get the incremental impulse
          matrix.subVec2(d, x, a);

          // Apply incremental impulse
          matrix.scaleVec2(P1, d.x, normal);
          matrix.scaleVec2(P2, d.y, normal);

          matrix.combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
          wA -=
            iA *
            (matrix.crossVec2Vec2(vcp1.rA, P1) +
              matrix.crossVec2Vec2(vcp2.rA, P2));

          matrix.combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
          wB +=
            iB *
            (matrix.crossVec2Vec2(vcp1.rB, P1) +
              matrix.crossVec2Vec2(vcp2.rB, P2));

          // Accumulate
          vcp1.normalImpulse = x.x;
          vcp2.normalImpulse = x.y;

          break;
        }

        //
        // Case 2: vn1 = 0 and x2 = 0
        //
        // 0 = a11 * x1 + a12 * 0 + b1'
        // vn2 = a21 * x1 + a22 * 0 + b2'
        //
        x.x = -vcp1.normalMass * b.x;
        x.y = 0;
        vn1 = 0;
        vn2 = this.v_K.ex.y * x.x + b.y;

        if (x.x >= 0 && vn2 >= 0) {
          // Get the incremental impulse
          matrix.subVec2(d, x, a);

          // Apply incremental impulse
          matrix.scaleVec2(P1, d.x, normal);
          matrix.scaleVec2(P2, d.y, normal);

          matrix.combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
          wA -=
            iA *
            (matrix.crossVec2Vec2(vcp1.rA, P1) +
              matrix.crossVec2Vec2(vcp2.rA, P2));

          matrix.combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
          wB +=
            iB *
            (matrix.crossVec2Vec2(vcp1.rB, P1) +
              matrix.crossVec2Vec2(vcp2.rB, P2));

          // Accumulate
          vcp1.normalImpulse = x.x;
          vcp2.normalImpulse = x.y;

          break;
        }

        //
        // Case 3: vn2 = 0 and x1 = 0
        //
        // vn1 = a11 * 0 + a12 * x2 + b1'
        // 0 = a21 * 0 + a22 * x2 + b2'
        //
        x.x = 0;
        x.y = -vcp2.normalMass * b.y;
        vn1 = this.v_K.ey.x * x.y + b.x;
        vn2 = 0;

        if (x.y >= 0 && vn1 >= 0) {
          // Resubstitute for the incremental impulse
          matrix.subVec2(d, x, a);

          // Apply incremental impulse
          matrix.scaleVec2(P1, d.x, normal);
          matrix.scaleVec2(P2, d.y, normal);

          matrix.combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
          wA -=
            iA *
            (matrix.crossVec2Vec2(vcp1.rA, P1) +
              matrix.crossVec2Vec2(vcp2.rA, P2));

          matrix.combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
          wB +=
            iB *
            (matrix.crossVec2Vec2(vcp1.rB, P1) +
              matrix.crossVec2Vec2(vcp2.rB, P2));

          // Accumulate
          vcp1.normalImpulse = x.x;
          vcp2.normalImpulse = x.y;

          break;
        }

        //
        // Case 4: x1 = 0 and x2 = 0
        //
        // vn1 = b1
        // vn2 = b2
        //
        x.x = 0;
        x.y = 0;
        vn1 = b.x;
        vn2 = b.y;

        if (vn1 >= 0 && vn2 >= 0) {
          // Resubstitute for the incremental impulse
          matrix.subVec2(d, x, a);

          // Apply incremental impulse
          matrix.scaleVec2(P1, d.x, normal);
          matrix.scaleVec2(P2, d.y, normal);

          matrix.combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
          wA -=
            iA *
            (matrix.crossVec2Vec2(vcp1.rA, P1) +
              matrix.crossVec2Vec2(vcp2.rA, P2));

          matrix.combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
          wB +=
            iB *
            (matrix.crossVec2Vec2(vcp1.rB, P1) +
              matrix.crossVec2Vec2(vcp2.rB, P2));

          // Accumulate
          vcp1.normalImpulse = x.x;
          vcp2.normalImpulse = x.y;

          break;
        }

        // No solution, give up. This is hit sometimes, but it doesn't seem to
        // matter.
        break;
      }
    }

    matrix.copyVec2(velocityA.v, vA);
    velocityA.w = wA;

    matrix.copyVec2(velocityB.v, vB);
    velocityB.w = wB;
  }
  static addType(
    type1: ShapeType,
    type2: ShapeType,
    callback: EvaluateFunction,
  ): void {
    s_registers[type1] = s_registers[type1] || {};
    s_registers[type1][type2] = callback;
  }
  static create(fixtureA: Fixture, fixtureB: Fixture): Contact | null {
    const typeA = fixtureA.m_shape.m_type;
    const typeB = fixtureB.m_shape.m_type;

    const contact = contactPool.allocate();
    let evaluateFcn;

    if ((evaluateFcn = s_registers[typeA] && s_registers[typeA][typeB])) {
      contact.initialize(fixtureA, fixtureB, evaluateFcn);
    } else if (
      (evaluateFcn = s_registers[typeB] && s_registers[typeB][typeA])
    ) {
      contact.initialize(fixtureB, fixtureA, evaluateFcn);
    } else {
      return null;
    }

    // Contact creation may swap fixtures.
    fixtureA = contact.m_fixtureA;
    fixtureB = contact.m_fixtureB;
    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    // Connect to body A
    contact.m_nodeA.contact = contact;
    contact.m_nodeA.other = bodyB;

    contact.m_nodeA.prev = null;
    contact.m_nodeA.next = bodyA.m_contactList;

    if (bodyA.m_contactList != null) {
      bodyA.m_contactList.prev = contact.m_nodeA;
    }
    bodyA.m_contactList = contact.m_nodeA;

    // Connect to body B
    contact.m_nodeB.contact = contact;
    contact.m_nodeB.other = bodyA;

    contact.m_nodeB.prev = null;
    contact.m_nodeB.next = bodyB.m_contactList;

    if (bodyB.m_contactList != null) {
      bodyB.m_contactList.prev = contact.m_nodeB;
    }
    bodyB.m_contactList = contact.m_nodeB;

    return contact;
  }
  static destroy(contact: Contact): void {
    const fixtureA = contact.m_fixtureA;
    const fixtureB = contact.m_fixtureB;

    const bodyA = fixtureA.m_body;
    const bodyB = fixtureB.m_body;

    // Remove from body 1
    if (contact.m_nodeA.prev) {
      contact.m_nodeA.prev.next = contact.m_nodeA.next;
    }

    if (contact.m_nodeA.next) {
      contact.m_nodeA.next.prev = contact.m_nodeA.prev;
    }

    if (contact.m_nodeA === bodyA.m_contactList) {
      bodyA.m_contactList = contact.m_nodeA.next;
    }

    // Remove from body 2
    if (contact.m_nodeB.prev) {
      contact.m_nodeB.prev.next = contact.m_nodeB.next;
    }

    if (contact.m_nodeB.next) {
      contact.m_nodeB.next.prev = contact.m_nodeB.prev;
    }

    if (contact.m_nodeB === bodyB.m_contactList) {
      bodyB.m_contactList = contact.m_nodeB.next;
    }

    contactPool.release(contact);
  }
}
