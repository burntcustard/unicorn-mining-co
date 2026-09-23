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
import { options } from '../utilities/merge-options';
import { Vec2, Vec2Value } from '../common/physics-vector';

import { Sweep } from '../common/motion-sweep';
import { Transform, TransformValue } from '../common/physics-transform';
import { Velocity } from './body-velocity';
import { Position } from './body-position';
import { Fixture, FixtureDef, FixtureOpt } from './collision-fixture';
import { Shape } from '../collision/collision-shape';
import { World } from './physics-world';
import { ContactEdge } from './collision-contact';

/** @internal */ const _ASSERT = false;

/**
 * A static body does not move under simulation and behaves as if it has infinite mass.
 * Internally, zero is stored for the mass and the inverse mass.
 * Static bodies can be moved manually by the user.
 * A static body has zero velocity.
 * Static bodies do not collide with other static or kinematic bodies.
 *
 * A kinematic body moves under simulation according to its velocity.
 * Kinematic bodies do not respond to forces.
 * They can be moved manually by the user, but normally a kinematic body is moved by setting its velocity.
 * A kinematic body behaves as if it has infinite mass, however, zero is stored for the mass and the inverse mass.
 * Kinematic bodies do not collide with other kinematic or static bodies.
 *
 * A dynamic body is fully simulated.
 * They can be moved manually by the user, but normally they move according to forces.
 * A dynamic body can collide with all body types.
 * A dynamic body always has finite, non-zero mass.
 * If you try to set the mass of a dynamic body to zero, it will automatically acquire a mass of one kilogram and it won't rotate.
 */
export type BodyType = 'static' | 'kinematic' | 'dynamic';

/** @internal */ const STATIC = 'static';
/** @internal */ const KINEMATIC = 'kinematic';
/** @internal */ const DYNAMIC = 'dynamic';

/** @internal */ const oldCenter = matrix.vec2(0, 0);
/** @internal */ const localCenter = matrix.vec2(0, 0);
/** @internal */ const shift = matrix.vec2(0, 0);
/** @internal */ const temp = matrix.vec2(0, 0);
/** @internal */ const xf = matrix.transform(0, 0, 0);

export interface BodyDef {
  /**
   * Body types are static, kinematic, or dynamic. Note: if a dynamic
   * body would have zero mass, the mass is set to one.
   */
  type?: BodyType;
  /**
   * The world position of the body. Avoid creating bodies at the
   * origin since this can lead to many overlapping shapes.
   */
  position?: Vec2Value;
  /**
   * The world angle of the body in radians.
   */
  angle?: number;
  /**
   * The linear velocity of the body's origin in world co-ordinates.
   */
  linearVelocity?: Vec2Value;
  angularVelocity?: number;
  /**
   * Linear damping is use to reduce the linear velocity. The
   * damping parameter can be larger than 1.0 but the damping effect becomes
   * sensitive to the time step when the damping parameter is large.
   * Units are 1/time
   */
  linearDamping?: number;
  /**
   * Angular damping is use to reduce the angular velocity.
   * The damping parameter can be larger than 1.0 but the damping effect
   * becomes sensitive to the time step when the damping parameter is large.
   * Units are 1/time
   */
  angularDamping?: number;
  /**
   * Should this body be prevented from rotating? Useful for characters.
   */
  fixedRotation?: boolean;
  /**
   * Is this a fast moving body that should be prevented from
   * tunneling through other moving bodies? Note that all bodies are
   * prevented from tunneling through kinematic and static bodies. This
   * setting is only considered on dynamic bodies. Warning: You should use
   * this flag sparingly since it increases processing time.
   */
  bullet?: boolean;
  gravityScale?: number;
  /**
   * Set this flag to false if this body should never fall asleep. Note that this increases CPU usage.
   */
  allowSleep?: boolean;
  /**
   * Is this body initially awake or sleeping?
   */
  awake?: boolean;
  /**
   * Does this body start out active?
   */
  active?: boolean;
  userData?: any;

  /** Styling for dev-tools. */
}

/** @internal */ const BodyDefDefault: BodyDef = {
  type: STATIC,
  position: Vec2.zero(),
  angle: 0.0,

  linearVelocity: Vec2.zero(),
  angularVelocity: 0.0,

  linearDamping: 0.0,
  angularDamping: 0.0,

  fixedRotation: false,
  bullet: false,
  gravityScale: 1.0,

  allowSleep: true,
  awake: true,
  active: true,

  userData: null,
};

/**
 * MassData This holds the mass data computed for a shape.
 */
export interface MassData {
  /** The mass of the shape, usually in kilograms. */
  mass: number;
  /** The position of the shape's centroid relative to the shape's origin. */
  center: Vec2Value;
  /** The rotational inertia of the shape about the local origin. */
  I: number;
}

/**
 * A rigid body composed of one or more fixtures.
 *
 * To create a new Body use {@link World.createBody}.
 */
export class Body {
  /** @hidden */
  static readonly STATIC: BodyType = 'static';
  /** @hidden */
  static readonly KINEMATIC: BodyType = 'kinematic';
  /** @hidden */
  static readonly DYNAMIC: BodyType = 'dynamic';

  /** @internal */ m_world: World;
  /** @internal */ m_awakeFlag: boolean;
  /** @internal */ m_autoSleepFlag: boolean;
  /** @internal */ m_bulletFlag: boolean;
  /** @internal */ m_fixedRotationFlag: boolean;
  /** @internal */ m_activeFlag: boolean;
  /** @internal */ m_islandFlag: boolean;
  /** @internal */ m_toiFlag: boolean;
  /** @internal */ m_userData: unknown;
  /** @internal */ m_type: BodyType;
  /** @internal */ m_mass: number;
  /** @internal */ m_invMass: number;
  /** @internal Rotational inertia about the center of mass. */
  m_I: number;
  /** @internal */ m_invI: number;
  /** @internal the body origin transform */
  m_xf: Transform;
  /** @internal the swept motion for CCD */
  m_sweep: Sweep;
  // position and velocity correction
  /** @internal */ c_velocity: Velocity;
  /** @internal */ c_position: Position;
  /** @internal */ m_force: Vec2;
  /** @internal */ m_torque: number;
  /** @internal */ m_linearVelocity: Vec2;
  /** @internal */ m_angularVelocity: number;
  /** @internal */ m_linearDamping: number;
  /** @internal */ m_angularDamping: number;
  /** @internal */ m_gravityScale: number;
  /** @internal */ m_sleepTime: number;
  /** @internal */ m_contactList: ContactEdge | null;
  /** @internal */ m_fixtureList: Fixture | null;
  /** @internal */ m_prev: Body | null;
  /** @internal */ m_next: Body | null;
  /** @internal */ m_destroyed: boolean;

  /** @internal */
  constructor(world: World, def: BodyDef) {
    def = options(def, BodyDefDefault);

    if (_ASSERT) console.assert(Vec2.isValid(def.position));

    if (_ASSERT) console.assert(Vec2.isValid(def.linearVelocity));

    if (_ASSERT) console.assert(Number.isFinite(def.angle));

    if (_ASSERT) console.assert(Number.isFinite(def.angularVelocity));

    if (_ASSERT) {
      console.assert(
        Number.isFinite(def.angularDamping) && def.angularDamping >= 0.0,
      );
    }

    if (_ASSERT) {
      console.assert(
        Number.isFinite(def.linearDamping) && def.linearDamping >= 0.0,
      );
    }

    this.m_world = world;

    this.m_awakeFlag = def.awake;
    this.m_autoSleepFlag = def.allowSleep;
    this.m_bulletFlag = def.bullet;
    this.m_fixedRotationFlag = def.fixedRotation;
    this.m_activeFlag = def.active;

    this.m_islandFlag = false;
    this.m_toiFlag = false;

    this.m_userData = def.userData;
    this.m_type = def.type;

    if (this.m_type == DYNAMIC) {
      this.m_mass = 1.0;
      this.m_invMass = 1.0;
    } else {
      this.m_mass = 0.0;
      this.m_invMass = 0.0;
    }

    // Rotational inertia about the center of mass.
    this.m_I = 0.0;
    this.m_invI = 0.0;

    // the body origin transform
    this.m_xf = Transform.identity();
    this.m_xf.p.setVec2(def.position);
    this.m_xf.q.setAngle(def.angle);

    // the swept motion for CCD
    this.m_sweep = new Sweep();
    this.m_sweep.setTransform(this.m_xf);

    // position and velocity correction
    this.c_velocity = new Velocity();
    this.c_position = new Position();

    this.m_force = Vec2.zero();
    this.m_torque = 0.0;

    this.m_linearVelocity = Vec2.clone(def.linearVelocity);
    this.m_angularVelocity = def.angularVelocity;

    this.m_linearDamping = def.linearDamping;
    this.m_angularDamping = def.angularDamping;
    this.m_gravityScale = def.gravityScale;

    this.m_sleepTime = 0.0;

    this.m_contactList = null;
    this.m_fixtureList = null;

    this.m_prev = null;
    this.m_next = null;

    this.m_destroyed = false;
  }

  isWorldLocked(): boolean {
    return this.m_world && this.m_world.isLocked() ? true : false;
  }

  getFixtureList(): Fixture | null {
    return this.m_fixtureList;
  }

  /**
   * Warning: this list changes during the time step and you may miss some
   * collisions if you don't use ContactListener.
   */
  getContactList(): ContactEdge | null {
    return this.m_contactList;
  }

  isStatic(): boolean {
    return this.m_type == STATIC;
  }

  isDynamic(): boolean {
    return this.m_type == DYNAMIC;
  }

  isKinematic(): boolean {
    return this.m_type == KINEMATIC;
  }

  /**
   * Get the type of the body.
   */
  getType(): BodyType {
    return this.m_type;
  }

  /**
   * Set the type of the body to "static", "kinematic" or "dynamic".
   * @param type The type of the body.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   */
  setType(type: BodyType): void {
    if (_ASSERT) {
      console.assert(type === STATIC || type === KINEMATIC || type === DYNAMIC);
    }

    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return;
    }

    if (this.m_type == type) {
      return;
    }

    this.m_type = type;

    this.resetMassData();

    if (this.m_type == STATIC) {
      this.m_linearVelocity.setZero();
      this.m_angularVelocity = 0.0;
      this.m_sweep.forward();
      this.synchronizeFixtures();
    }

    this.setAwake(true);

    this.m_force.setZero();
    this.m_torque = 0.0;

    // Delete the attached contacts.
    let ce = this.m_contactList;

    while (ce) {
      const ce0 = ce;

      ce = ce.next;
      this.m_world.destroyContact(ce0.contact);
    }
    this.m_contactList = null;

    // Touch the proxies so that new contacts will be created (when appropriate)
    const broadPhase = this.m_world.m_broadPhase;

    for (let f = this.m_fixtureList; f; f = f.m_next) {
      for (let i = 0; i < f.m_proxyCount; ++i) {
        broadPhase.touchProxy(f.m_proxies[i].proxyId);
      }
    }
  }

  isBullet(): boolean {
    return this.m_bulletFlag;
  }

  isAwake(): boolean {
    return this.m_awakeFlag;
  }

  /**
   * Set the sleep state of the body. A sleeping body has very low CPU cost.
   *
   * @param flag Set to true to wake the body, false to put it to sleep.
   */
  setAwake(flag: boolean): void {
    if (flag) {
      this.m_awakeFlag = true;
      this.m_sleepTime = 0.0;
    } else {
      this.m_awakeFlag = false;
      this.m_sleepTime = 0.0;
      this.m_linearVelocity.setZero();
      this.m_angularVelocity = 0.0;
      this.m_force.setZero();
      this.m_torque = 0.0;
    }
  }

  isActive(): boolean {
    return this.m_activeFlag;
  }

  /**
   * Get the world transform for the body's origin.
   */
  getTransform(): Transform {
    return this.m_xf;
  }

  /**
   * Set the position of the body's origin and rotation. Manipulating a body's
   * transform may cause non-physical behavior. Note: contacts are updated on the
   * next call to World.step.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   *
   * @param position The world position of the body's local origin.
   * @param angle The world rotation in radians.
   */
  setTransform(position: Vec2Value, angle: number): void;
  /**
   * Set the position of the body's origin and rotation. Manipulating a body's
   * transform may cause non-physical behavior. Note: contacts are updated on the
   * next call to World.step.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   */
  setTransform(xf: Transform): void;
  setTransform(a: Vec2Value | Transform, b?: number): void {
    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return;
    }

    if (typeof b === 'number') {
      this.m_xf.setNum(a as Vec2Value, b);
    } else {
      this.m_xf.setTransform(a as TransformValue);
    }

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
   * Get the world position of the center of mass.
   */
  getWorldCenter(): Vec2 {
    return this.m_sweep.c;
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
    if (this.m_type == STATIC) {
      return;
    }

    if (Vec2.dot(v, v) > 0.0) {
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
    if (this.m_type == STATIC) {
      return;
    }

    if (w * w > 0.0) {
      this.setAwake(true);
    }
    this.m_angularVelocity = w;
  }

  /**
   * Get the body's mass.
   */
  getMass(): number {
    return this.m_mass;
  }

  getInertia(): number {
    return (
      this.m_I +
      this.m_mass * Vec2.dot(this.m_sweep.localCenter, this.m_sweep.localCenter)
    );
  }

  getMassData(data: MassData): void {
    data.mass = this.m_mass;
    data.I = this.getInertia();
    matrix.copyVec2(data.center, this.m_sweep.localCenter);
  }

  /**
   * This resets the mass properties to the sum of the mass properties of the
   * fixtures. This normally does not need to be called unless you called
   * SetMassData to override the mass and you later want to reset the mass.
   */
  resetMassData(): void {
    // Compute mass data from shapes. Each shape has its own density.
    this.m_mass = 0.0;
    this.m_invMass = 0.0;
    this.m_I = 0.0;
    this.m_invI = 0.0;
    matrix.zeroVec2(this.m_sweep.localCenter);

    // Static and kinematic bodies have zero mass.
    if (this.isStatic() || this.isKinematic()) {
      matrix.copyVec2(this.m_sweep.c0, this.m_xf.p);
      matrix.copyVec2(this.m_sweep.c, this.m_xf.p);
      this.m_sweep.a0 = this.m_sweep.a;
      return;
    }

    if (_ASSERT) console.assert(this.isDynamic());

    // Accumulate mass over all fixtures.
    matrix.zeroVec2(localCenter);

    for (let f = this.m_fixtureList; f; f = f.m_next) {
      if (f.m_density == 0.0) {
        continue;
      }

      const massData: MassData = {
        mass: 0,
        center: matrix.vec2(0, 0),
        I: 0,
      };

      f.getMassData(massData);
      this.m_mass += massData.mass;
      matrix.plusScaleVec2(localCenter, massData.mass, massData.center);
      this.m_I += massData.I;
    }

    // Compute center of mass.
    if (this.m_mass > 0.0) {
      this.m_invMass = 1.0 / this.m_mass;
      matrix.scaleVec2(localCenter, this.m_invMass, localCenter);
    } else {
      // Force all dynamic bodies to have a positive mass.
      this.m_mass = 1.0;
      this.m_invMass = 1.0;
    }

    if (this.m_I > 0.0 && this.m_fixedRotationFlag == false) {
      // Center the inertia about the center of mass.
      this.m_I -= this.m_mass * matrix.dotVec2(localCenter, localCenter);

      if (_ASSERT) console.assert(this.m_I > 0.0);
      this.m_invI = 1.0 / this.m_I;
    } else {
      this.m_I = 0.0;
      this.m_invI = 0.0;
    }

    // Move center of mass.
    matrix.copyVec2(oldCenter, this.m_sweep.c);
    this.m_sweep.setLocalCenter(localCenter, this.m_xf);

    // Update center of mass velocity.
    matrix.subVec2(shift, this.m_sweep.c, oldCenter);
    matrix.crossNumVec2(temp, this.m_angularVelocity, shift);
    matrix.plusVec2(this.m_linearVelocity, temp);
  }

  /**
   * Set the mass properties to override the mass properties of the fixtures. Note
   * that this changes the center of mass position. Note that creating or
   * destroying fixtures can also alter the mass. This function has no effect if
   * the body isn't dynamic.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   *
   * @param massData The mass properties.
   */
  setMassData(massData: MassData): void {
    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return;
    }

    if (this.m_type != DYNAMIC) {
      return;
    }

    this.m_invMass = 0.0;
    this.m_I = 0.0;
    this.m_invI = 0.0;

    this.m_mass = massData.mass;

    if (this.m_mass <= 0.0) {
      this.m_mass = 1.0;
    }

    this.m_invMass = 1.0 / this.m_mass;

    if (massData.I > 0.0 && this.m_fixedRotationFlag == false) {
      this.m_I =
        massData.I -
        this.m_mass * matrix.dotVec2(massData.center, massData.center);

      if (_ASSERT) console.assert(this.m_I > 0.0);
      this.m_invI = 1.0 / this.m_I;
    }

    // Move center of mass.
    matrix.copyVec2(oldCenter, this.m_sweep.c);
    this.m_sweep.setLocalCenter(massData.center, this.m_xf);

    // Update center of mass velocity.
    matrix.subVec2(shift, this.m_sweep.c, oldCenter);
    matrix.crossNumVec2(temp, this.m_angularVelocity, shift);
    matrix.plusVec2(this.m_linearVelocity, temp);
  }

  /**
   * This is used to test if two bodies should collide.
   *
   * Bodies do not collide when:
   * - Neither of them is dynamic
   */
  shouldCollide(that: Body): boolean {
    // At least one body should be dynamic.
    if (this.m_type != DYNAMIC && that.m_type != DYNAMIC) {
      return false;
    }
    return true;
  }

  /** @internal Attach a fixture and update mass and broad-phase proxies. */
  _addFixture(fixture: Fixture): Fixture {
    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return null;
    }

    if (this.m_activeFlag) {
      const broadPhase = this.m_world.m_broadPhase;

      fixture.createProxies(broadPhase, this.m_xf);
    }

    fixture.m_next = this.m_fixtureList;
    this.m_fixtureList = fixture;

    // Adjust mass properties if needed.
    if (fixture.m_density > 0.0) {
      this.resetMassData();
    }

    // Let the world know we have a new fixture. This will cause new contacts
    // to be created at the beginning of the next time step.
    this.m_world.m_newFixture = true;

    return fixture;
  }

  /**
   * Creates a fixture and attach it to this body.
   *
   * If the density is non-zero, this function automatically updates the mass of
   * the body.
   *
   * Contacts are not created until the next time step.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   */
  createFixture(def: FixtureDef): Fixture;
  createFixture(shape: Shape, opt?: FixtureOpt): Fixture;
  createFixture(shape: Shape, density?: number): Fixture;
  // tslint:disable-next-line:typedef
  createFixture(shape: any, fixdef?: any) {
    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return null;
    }

    const fixture = new Fixture(this, shape, fixdef);

    this._addFixture(fixture);
    this.m_world.publish('add-fixture', fixture);
    return fixture;
  }

  /**
   * Destroy a fixture. This removes the fixture from the broad-phase and destroys
   * all contacts associated with this fixture. This will automatically adjust the
   * mass of the body if the body is dynamic and the fixture has positive density.
   * All fixtures attached to a body are implicitly destroyed when the body is
   * destroyed.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   *
   * @param fixture The fixture to be removed.
   */
  destroyFixture(fixture: Fixture): void {
    if (_ASSERT) console.assert(this.isWorldLocked() == false);

    if (this.isWorldLocked() == true) {
      return;
    }

    if (_ASSERT) console.assert(fixture.m_body == this);

    // Remove the fixture from this body's singly linked list.
    let found = false;

    if (this.m_fixtureList === fixture) {
      this.m_fixtureList = fixture.m_next;
      found = true;
    } else {
      let node = this.m_fixtureList;

      while (node != null) {
        if (node.m_next === fixture) {
          node.m_next = fixture.m_next;
          found = true;
          break;
        }
        node = node.m_next;
      }
    }

    // You tried to remove a shape that is not attached to this body.
    if (_ASSERT) console.assert(found);

    // Destroy any contacts associated with the fixture.
    let edge = this.m_contactList;

    while (edge) {
      const c = edge.contact;

      edge = edge.next;

      const fixtureA = c.getFixtureA();
      const fixtureB = c.getFixtureB();

      if (fixture == fixtureA || fixture == fixtureB) {
        // This destroys the contact and removes it from
        // this body's contact list.
        this.m_world.destroyContact(c);
      }
    }

    if (this.m_activeFlag) {
      const broadPhase = this.m_world.m_broadPhase;

      fixture.destroyProxies(broadPhase);
    }

    fixture.m_body = null;
    fixture.m_next = null;

    this.m_world.publish('remove-fixture', fixture);

    // Reset the mass data.
    this.resetMassData();
  }
}
