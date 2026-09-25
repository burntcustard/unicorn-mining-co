/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/dynamics/Body.ts
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

import * as matrix from '../common/physics-matrix';
import { Vec2, Vec2Value } from '../vector';

import { Sweep } from '../common/motion-sweep';
import { Transform } from '../common/physics-transform';
import { Fixture, FixtureOpt } from './collision-fixture';
import { Shape } from '../collision/collision-shape';
import { World } from './physics-world';
import { ContactEdge } from './collision-contact';

/**
 * Dynamic bodies respond to contact impulses. Massless kinematic bodies move
 * with their assigned velocity and can contact dynamic bodies without receiving
 * an impulse.
 */
export type BodyType = 'kinematic' | 'dynamic';

/* Body state adapted from Planck Position.ts and Velocity.ts; MIT licensed. */
class Velocity {
  v = Vec2.zero();
  w = 0;
}

class Position {
  c = Vec2.zero();
  a = 0;
}

const DYNAMIC = 'dynamic';

const xf = matrix.transform(0, 0, 0);

export interface BodyDef {
  type: BodyType;
  mass: number;
}

/**
 * A rigid body composed of one or more fixtures.
 *
 * To create a new Body use {@link World.createBody}.
 */
export class Body {
  m_world: World;
  m_awakeFlag: boolean;
  m_islandFlag: boolean;
  m_type: BodyType;
  m_invMass: number;
  m_invI: number;
  c_velocity: Velocity;
  c_position: Position;
  m_linearVelocity: Vec2;
  m_angularVelocity: number;
  m_contactList: ContactEdge | null;
  m_fixtureList: Fixture | null;
  m_prev: Body | null;
  m_next: Body | null;
  m_destroyed: boolean;

  /** the body origin transform */
  m_xf: Transform;
  /** the swept motion for CCD */
  m_sweep: Sweep;
  // position and velocity correction
  constructor(world: World, def: BodyDef) {
    this.m_world = world;

    this.m_awakeFlag = true;

    this.m_islandFlag = false;

    this.m_type = def.type;

    this.m_invMass = this.m_type === DYNAMIC ? 1 / def.mass : 0;
    this.m_invI = 0;

    // the body origin transform
    this.m_xf = new Transform();

    // the swept motion for CCD
    this.m_sweep = new Sweep();
    this.m_sweep.setTransform(this.m_xf);

    // position and velocity correction
    this.c_velocity = new Velocity();
    this.c_position = new Position();

    this.m_linearVelocity = Vec2.zero();
    this.m_angularVelocity = 0;

    this.m_contactList = null;
    this.m_fixtureList = null;

    this.m_prev = null;
    this.m_next = null;

    this.m_destroyed = false;
  }

  isWorldLocked(): boolean {
    return this.m_world.isLocked();
  }

  /**
   * Warning: this list changes during the time step and you may miss some
   * collisions if it is inspected during a step.
   */
  getContactList(): ContactEdge | null {
    return this.m_contactList;
  }

  isDynamic(): boolean {
    return this.m_type === DYNAMIC;
  }

  isAwake(): boolean {
    return this.m_awakeFlag;
  }

  // Keep bodies awake when contacts change or new motion is assigned.
  setAwake(flag: boolean): void {
    this.m_awakeFlag = flag;

    if (!flag) {
      this.m_linearVelocity.setZero();
      this.m_angularVelocity = 0;
    }
  }

  /**
   * Get the world transform for the body's origin.
   */
  getTransform(): Transform {
    return this.m_xf;
  }

  // Set the body's pose before the next physics step.
  setTransform(position: Vec2Value, angle: number): void {
    if (this.isWorldLocked()) return;

    this.m_xf.setNum(position, angle);
    this.m_sweep.setTransform(this.m_xf);

    const broadPhase = this.m_world.m_broadPhase;

    for (let f = this.m_fixtureList; f; f = f.m_next) {
      f.synchronize(broadPhase, this.m_xf, this.m_xf);
    }
    this.setAwake(true);
  }

  synchronizeTransform(): void {
    this.m_sweep.getTransform(this.m_xf, 1);
  }

  /**
   * Update fixtures in broad-phase.
   */
  synchronizeFixtures(): void {
    this.m_sweep.getTransform(xf, 0);

    const broadPhase = this.m_world.m_broadPhase;

    for (let f = this.m_fixtureList; f; f = f.m_next) {
      f.synchronize(broadPhase, xf, this.m_xf);
    }
  }

  /**
   * Used in TOI.
   */
  advance(alpha: number): void {
    // Advance to the new safe time. This doesn't sync the broad-phase.
    this.m_sweep.advance(alpha);
    matrix.copyVec2(this.m_sweep.c, this.m_sweep.c0);
    this.m_sweep.a = this.m_sweep.a0;
    this.m_sweep.getTransform(this.m_xf, 1);
  }

  /**
   * Get the world position for the body's origin.
   */
  getPosition(): Vec2 {
    return this.m_xf.p;
  }

  /**
   * Get the current world rotation angle in radians.
   */
  getAngle(): number {
    return this.m_sweep.a;
  }

  /**
   * Get the linear velocity of the center of mass.
   *
   * @return the linear velocity of the center of mass.
   */
  getLinearVelocity(): Vec2 {
    return this.m_linearVelocity;
  }

  /**
   * Get the world linear velocity of a world point attached to this body.
   *
   * @param worldPoint A point in world coordinates.
   */
  getLinearVelocityFromWorldPoint(worldPoint: Vec2Value): Vec2 {
    const localCenter = Vec2.sub(worldPoint, this.m_sweep.c);

    return Vec2.add(
      this.m_linearVelocity,
      Vec2.crossNumVec2(this.m_angularVelocity, localCenter),
    );
  }

  /**
   * Set the linear velocity of the center of mass.
   *
   * @param v The new linear velocity of the center of mass.
   */
  setLinearVelocity(v: Vec2Value): void {
    if (matrix.dotVec2(v, v) > 0) {
      this.setAwake(true);
    }
    this.m_linearVelocity.setVec2(v);
  }

  /**
   * Get the angular velocity.
   *
   * @returns the angular velocity in radians/second.
   */
  getAngularVelocity(): number {
    return this.m_angularVelocity;
  }

  /**
   * Set the angular velocity.
   *
   * @param w The new angular velocity in radians/second.
   */
  setAngularVelocity(w: number): void {
    if (w * w > 0) {
      this.setAwake(true);
    }
    this.m_angularVelocity = w;
  }

  // Game objects own mass. Shape geometry supplies only spin resistance.
  setMass(mass: number, inertia: number): void {
    if (this.isWorldLocked() || !this.isDynamic()) return;

    this.m_invMass = 1 / mass;
    this.m_invI = inertia > 0 ? 1 / inertia : 0;
  }

  /**
   * This is used to test if two bodies should collide.
   *
   * Bodies do not collide when:
   * - Neither of them is dynamic
   */
  shouldCollide(that: Body): boolean {
    // At least one body should be dynamic.
    if (this.m_type !== DYNAMIC && that.m_type !== DYNAMIC) {
      return false;
    }
    return true;
  }

  /** Attach a fixture and create its broad-phase proxy. */
  _addFixture(fixture: Fixture): Fixture {
    if (this.isWorldLocked()) {
      return null;
    }

    fixture.createProxies(this.m_world.m_broadPhase, this.m_xf);

    fixture.m_next = this.m_fixtureList;
    this.m_fixtureList = fixture;

    // Let the world know we have a new fixture. This will cause new contacts
    // to be created at the beginning of the next time step.
    this.m_world.m_newFixture = true;

    return fixture;
  }

  /** Attach a shape to this body for collision detection and response. */
  createFixture(shape: Shape, definition: FixtureOpt): Fixture {
    if (this.isWorldLocked()) {
      return null;
    }

    const fixture = new Fixture(this, shape, definition);

    this._addFixture(fixture);
    return fixture;
  }

  /**
   * Destroy a fixture. This removes the fixture from the broad-phase and destroys
   * all contacts associated with this fixture.
   * All fixtures attached to a body are implicitly destroyed when the body is
   * destroyed.
   *
   * Bodies and fixtures are changed between physics steps.
   *
   * @param fixture The fixture to be removed.
   */
  destroyFixture(fixture: Fixture): void {
    if (this.isWorldLocked()) {
      return;
    }

    // Remove the fixture from this body's singly linked list.
    if (this.m_fixtureList === fixture) {
      this.m_fixtureList = fixture.m_next;
    } else {
      let node = this.m_fixtureList;

      while (node != null) {
        if (node.m_next === fixture) {
          node.m_next = fixture.m_next;
          break;
        }
        node = node.m_next;
      }
    }

    // Destroy any contacts associated with the fixture.
    let edge = this.m_contactList;

    while (edge) {
      const c = edge.contact;

      edge = edge.next;

      const fixtureA = c.getFixtureA();
      const fixtureB = c.getFixtureB();

      if (fixture === fixtureA || fixture === fixtureB) {
        // This destroys the contact and removes it from
        // this body's contact list.
        this.m_world.destroyContact(c);
      }
    }

    fixture.destroyProxies(this.m_world.m_broadPhase);

    fixture.m_body = null;
    fixture.m_next = null;
  }
}
