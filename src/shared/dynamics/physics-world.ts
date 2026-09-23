/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/dynamics/World.ts
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

import { options } from '../utilities/merge-options';
import { Vec2, Vec2Value } from '../common/physics-vector';
import { BroadPhase } from '../collision/broad-phase';
import { Solver, ContactImpulse, TimeStep } from './physics-solver';
import { Body, BodyDef } from './physics-body';
import { Contact } from './collision-contact';

import { Fixture, FixtureProxy } from './collision-fixture';
import { Manifold } from '../collision/contact-manifold';

/** @internal */ const _ASSERT = false;

export interface WorldDef {
  /** [default: { x : 0, y : 0}] */
  gravity?: Vec2Value;

  /** [default: true] */
  allowSleep?: boolean;

  /** [default: true] */
  warmStarting?: boolean;

  /** [default: true] */
  continuousPhysics?: boolean;

  /** [default: false] */
  subStepping?: boolean;

  /** [default: true] */
  blockSolve?: boolean;

  /** @internal [8] For the velocity constraint solver. */
  velocityIterations?: number;

  /** @internal [3] For the position constraint solver. */
  positionIterations?: number;
}

/** @internal */ const DEFAULTS: WorldDef = {
  gravity: Vec2.zero(),
  allowSleep: true,
  warmStarting: true,
  continuousPhysics: true,
  subStepping: false,
  blockSolve: true,
  velocityIterations: 8,
  positionIterations: 3,
};

/**
 * Owns rigid bodies, contacts and the continuous collision solver.
 */
export class World {
  /** @internal */ m_solver: Solver;
  /** @internal */ m_broadPhase: BroadPhase;
  /** @internal */ m_contactList: Contact | null;
  /** @internal */ m_contactCount: number;
  /** @internal */ m_bodyList: Body | null;
  /** @internal */ m_bodyCount: number;
  /** @internal */ m_stepComplete: boolean;
  /** @internal */ m_allowSleep: boolean;
  /** @internal */ m_gravity: Vec2;
  /** @internal */ m_clearForces: boolean;
  /** @internal */ m_newFixture: boolean;
  /** @internal */ m_locked: boolean;
  /** @internal */ m_warmStarting: boolean;
  /** @internal */ m_continuousPhysics: boolean;
  /** @internal */ m_subStepping: boolean;
  /** @internal */ m_blockSolve: boolean;
  /** @internal */ m_velocityIterations: number;
  /** @internal */ m_positionIterations: number;
  /** @internal */ m_t: number;

  /** @internal */ m_step_callback: ((world: World) => unknown)[];

  // TODO
  /** @internal */ _listeners: {
    [key: string]: any[];
  };

  /**
   * @param def World definition or gravity vector.
   */
  constructor(def?: WorldDef | Vec2Value) {
    this.s_step = new TimeStep();

    if (!def) {
      def = {};
    } else if (Vec2.isValid(def)) {
      def = { gravity: def as Vec2 };
    }

    def = options(def, DEFAULTS) as WorldDef;

    this.m_solver = new Solver(this);

    this.m_broadPhase = new BroadPhase();

    this.m_contactList = null;
    this.m_contactCount = 0;

    this.m_bodyList = null;
    this.m_bodyCount = 0;

    this.m_stepComplete = true;

    this.m_allowSleep = def.allowSleep;
    this.m_gravity = Vec2.clone(def.gravity);

    this.m_clearForces = true;
    this.m_newFixture = false;
    this.m_locked = false;

    // These are for debugging the solver.
    this.m_warmStarting = def.warmStarting;
    this.m_continuousPhysics = def.continuousPhysics;
    this.m_subStepping = def.subStepping;

    this.m_blockSolve = def.blockSolve;
    this.m_velocityIterations = def.velocityIterations;
    this.m_positionIterations = def.positionIterations;

    this.m_t = 0;

    this.m_step_callback = [];
  }

  /**
   * Get the world contact list. With the returned contact, use Contact.getNext to
   * get the next contact in the world list. A null contact indicates the end of
   * the list.
   *
   * Warning: contacts are created and destroyed in the middle of a time step.
   * Use ContactListener to avoid missing contacts.
   *
   * @return the head of the world contact list.
   */
  getContactList(): Contact | null {
    return this.m_contactList;
  }

  /**
   * Is the world locked (in the middle of a time step).
   */
  isLocked(): boolean {
    return this.m_locked;
  }

  /**
   * Manually clear the force buffer on all bodies. By default, forces are cleared
   * automatically after each call to step. The default behavior is modified by
   * calling setAutoClearForces. The purpose of this function is to support
   * sub-stepping. Sub-stepping is often used to maintain a fixed sized time step
   * under a variable frame-rate. When you perform sub-stepping you will disable
   * auto clearing of forces and instead call clearForces after all sub-steps are
   * complete in one pass of your game loop.
   *
   * See {@link World.setAutoClearForces}
   */
  clearForces(): void {
    for (let body = this.m_bodyList; body; body = body.m_next) {
      body.m_force.setZero();
      body.m_torque = 0.0;
    }
  }

  /** @internal Add a body to the world's linked list. */
  _addBody(body: Body): void {
    if (_ASSERT) console.assert(this.isLocked() === false);

    if (this.isLocked()) {
      return;
    }

    // Add to world doubly linked list.
    body.m_prev = null;
    body.m_next = this.m_bodyList;

    if (this.m_bodyList) {
      this.m_bodyList.m_prev = body;
    }
    this.m_bodyList = body;
    ++this.m_bodyCount;

    this.publish('add-body', body);
  }

  /**
   * Create a rigid body given a definition. No reference to the definition is
   * retained.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   */
  createBody(def?: BodyDef): Body;
  createBody(position: Vec2Value, angle?: number): Body;
  // tslint:disable-next-line:typedef
  createBody(arg1?: any, arg2?: any) {
    if (_ASSERT) console.assert(this.isLocked() == false);

    if (this.isLocked()) {
      return null;
    }

    let def: BodyDef = {};

    if (!arg1) {
    } else if (Vec2.isValid(arg1)) {
      def = { position: arg1, angle: arg2 };
    } else if (typeof arg1 === 'object') {
      def = arg1;
    }

    const body = new Body(this, def);

    this._addBody(body);
    return body;
  }

  // tslint:disable-next-line:typedef

  // tslint:disable-next-line:typedef

  /**
   * Destroy a body from the world.
   *
   * Warning: This automatically deletes all associated shapes and contacts.
   *
   * Warning: This function is locked when a world simulation step is in progress. Use queueUpdate to schedule a function to be called after the step.
   */
  destroyBody(b: Body): boolean {
    if (_ASSERT) console.assert(this.m_bodyCount > 0);

    if (_ASSERT) console.assert(this.isLocked() == false);

    if (this.isLocked()) {
      return;
    }

    if (b.m_destroyed) {
      return false;
    }

    // Delete the attached contacts.
    let ce = b.m_contactList;

    while (ce) {
      const ce0 = ce;

      ce = ce.next;

      this.destroyContact(ce0.contact);

      b.m_contactList = ce;
    }
    b.m_contactList = null;

    // Delete the attached fixtures. This destroys broad-phase proxies.
    let f = b.m_fixtureList;

    while (f) {
      const f0 = f;

      f = f.m_next;

      this.publish('remove-fixture', f0);
      f0.destroyProxies(this.m_broadPhase);

      b.m_fixtureList = f;
    }
    b.m_fixtureList = null;

    // Remove world body list.
    if (b.m_prev) {
      b.m_prev.m_next = b.m_next;
    }

    if (b.m_next) {
      b.m_next.m_prev = b.m_prev;
    }

    if (b == this.m_bodyList) {
      this.m_bodyList = b.m_next;
    }

    b.m_destroyed = true;

    --this.m_bodyCount;

    this.publish('remove-body', b);

    return true;
  }

  /** @internal */
  s_step: TimeStep; // reuse

  /**
   * Take a time step. This performs collision detection, integration, and
   * constraint solution.
   *
   * Broad-phase, narrow-phase, solve and solve time of impacts.
   *
   * @param timeStep Time step, this should not vary.
   */
  step(
    timeStep: number,
    velocityIterations?: number,
    positionIterations?: number,
  ): void {
    this.publish('pre-step', timeStep);

    if ((velocityIterations | 0) !== velocityIterations) {
      // TODO: remove this in future
      velocityIterations = 0;
    }

    velocityIterations = velocityIterations || this.m_velocityIterations;
    positionIterations = positionIterations || this.m_positionIterations;

    // If new fixtures were added, we need to find the new contacts.
    if (this.m_newFixture) {
      this.findNewContacts();
      this.m_newFixture = false;
    }

    this.m_locked = true;

    this.s_step.reset(timeStep);
    this.s_step.velocityIterations = velocityIterations;
    this.s_step.positionIterations = positionIterations;
    this.s_step.warmStarting = this.m_warmStarting;
    this.s_step.blockSolve = this.m_blockSolve;

    // Update contacts. This is where some contacts are destroyed.
    this.updateContacts();

    // Integrate velocities, solve velocity constraints, and integrate positions.
    if (this.m_stepComplete && timeStep > 0.0) {
      this.m_solver.solveWorld(this.s_step);

      // Synchronize fixtures, check for out of range bodies.
      for (let b = this.m_bodyList; b; b = b.m_next) {
        // If a body was not in an island then it did not move.
        if (b.m_islandFlag == false) {
          continue;
        }

        if (b.isStatic()) {
          continue;
        }

        // Update fixtures (for broad-phase).
        b.synchronizeFixtures();
      }
      // Look for new contacts.
      this.findNewContacts();
    }

    // Handle TOI events.
    if (this.m_continuousPhysics && timeStep > 0.0) {
      this.m_solver.solveWorldTOI(this.s_step);
    }

    if (this.m_clearForces) {
      this.clearForces();
    }

    this.m_locked = false;

    let callback: (world: World) => unknown;

    while ((callback = this.m_step_callback.shift())) {
      callback(this);
    }

    this.publish('post-step', timeStep);
  }

  /**
   * Queue a function to be called after ongoing simulation step. If no simulation is in progress call it immediately.
   */
  queueUpdate(callback: (world: World) => unknown): void {
    if (!this.isLocked()) {
      callback(this);
    } else {
      this.m_step_callback.push(callback);
    }
  }

  /**
   * @internal
   * Call this method to find new contacts.
   */
  findNewContacts(): void {
    this.m_broadPhase.updatePairs(
      (proxyA: FixtureProxy, proxyB: FixtureProxy) =>
        this.createContact(proxyA, proxyB),
    );
  }

  /**
   * @internal
   * Callback for broad-phase.
   */
  createContact(proxyA: FixtureProxy, proxyB: FixtureProxy): void {
    const fixtureA = proxyA.fixture;
    const fixtureB = proxyB.fixture;

    const indexA = proxyA.childIndex;
    const indexB = proxyB.childIndex;

    const bodyA = fixtureA.getBody();
    const bodyB = fixtureB.getBody();

    // Are the fixtures on the same body?
    if (bodyA == bodyB) {
      return;
    }

    // TODO_ERIN use a hash table to remove a potential bottleneck when both
    // bodies have a lot of contacts.
    // Does a contact already exist?
    let edge = bodyB.getContactList();

    // ContactEdge
    while (edge) {
      if (edge.other == bodyA) {
        const fA = edge.contact.getFixtureA();
        const fB = edge.contact.getFixtureB();
        const iA = edge.contact.getChildIndexA();
        const iB = edge.contact.getChildIndexB();

        if (fA == fixtureA && fB == fixtureB && iA == indexA && iB == indexB) {
          // A contact already exists.
          return;
        }

        if (fA == fixtureB && fB == fixtureA && iA == indexB && iB == indexA) {
          // A contact already exists.
          return;
        }
      }

      edge = edge.next;
    }

    if (bodyB.shouldCollide(bodyA) == false) {
      return;
    }

    if (fixtureB.shouldCollide(fixtureA) == false) {
      return;
    }

    // Call the factory.
    const contact = Contact.create(fixtureA, indexA, fixtureB, indexB);

    if (contact == null) {
      return;
    }

    // Insert into the world.
    contact.m_prev = null;

    if (this.m_contactList != null) {
      contact.m_next = this.m_contactList;
      this.m_contactList.m_prev = contact;
    }
    this.m_contactList = contact;

    ++this.m_contactCount;
  }

  /**
   * @internal
   * Removes old non-overlapping contacts, applies filters and updates contacts.
   */
  updateContacts(): void {
    // Update awake contacts.
    let c: Contact;
    let next_c = this.m_contactList;

    while ((c = next_c)) {
      next_c = c.getNext();
      const fixtureA = c.getFixtureA();
      const fixtureB = c.getFixtureB();
      const indexA = c.getChildIndexA();
      const indexB = c.getChildIndexB();
      const bodyA = fixtureA.getBody();
      const bodyB = fixtureB.getBody();

      // Is this contact flagged for filtering?
      if (c.m_filterFlag) {
        if (bodyB.shouldCollide(bodyA) == false) {
          this.destroyContact(c);
          continue;
        }

        if (fixtureB.shouldCollide(fixtureA) == false) {
          this.destroyContact(c);
          continue;
        }

        // Clear the filtering flag.
        c.m_filterFlag = false;
      }

      const activeA = bodyA.isAwake() && !bodyA.isStatic();
      const activeB = bodyB.isAwake() && !bodyB.isStatic();

      // At least one body must be awake and it must be dynamic or kinematic.
      if (activeA == false && activeB == false) {
        continue;
      }

      const proxyIdA = fixtureA.m_proxies[indexA].proxyId;
      const proxyIdB = fixtureB.m_proxies[indexB].proxyId;
      const overlap = this.m_broadPhase.testOverlap(proxyIdA, proxyIdB);

      // Here we destroy contacts that cease to overlap in the broad-phase.
      if (overlap == false) {
        this.destroyContact(c);
        continue;
      }

      // The contact persists.
      c.update(this);
    }
  }

  /** @internal */
  destroyContact(contact: Contact): void {
    // Remove from the world.
    if (contact.m_prev) {
      contact.m_prev.m_next = contact.m_next;
    }

    if (contact.m_next) {
      contact.m_next.m_prev = contact.m_prev;
    }

    if (contact == this.m_contactList) {
      this.m_contactList = contact.m_next;
    }

    Contact.destroy(contact, this);

    --this.m_contactCount;
  }

  /**
   * Called when two fixtures begin to touch.
   *
   * Implement contact callbacks to get contact information. You can use these
   * results for things like sounds and game logic. You can also get contact
   * results by traversing the contact lists after the time step. However, you
   * might miss some contacts because continuous physics leads to sub-stepping.
   * Additionally you may receive multiple callbacks for the same contact in a
   * single time step. You should strive to make your callbacks efficient because
   * there may be many callbacks per time step.
   *
   * Warning: You cannot create/destroy world entities inside these callbacks.
   */
  on(name: 'begin-contact', listener: (contact: Contact) => void): World;
  /**
   * Called when two fixtures cease to touch.
   *
   * Implement contact callbacks to get contact information. You can use these
   * results for things like sounds and game logic. You can also get contact
   * results by traversing the contact lists after the time step. However, you
   * might miss some contacts because continuous physics leads to sub-stepping.
   * Additionally you may receive multiple callbacks for the same contact in a
   * single time step. You should strive to make your callbacks efficient because
   * there may be many callbacks per time step.
   *
   * Warning: You cannot create/destroy world entities inside these callbacks.
   */
  on(name: 'end-contact', listener: (contact: Contact) => void): World;
  /**
   * This is called after a contact is updated. This allows you to inspect a
   * contact before it goes to the solver. If you are careful, you can modify the
   * contact manifold (e.g. disable contact). A copy of the old manifold is
   * provided so that you can detect changes. Note: this is called only for awake
   * bodies. Note: this is called even when the number of contact points is zero.
   * Note: if you set the number of contact
   * points to zero, you will not get an end-contact callback. However, you may get
   * a begin-contact callback the next step.
   *
   * Warning: You cannot create/destroy world entities inside these callbacks.
   */
  on(
    name: 'pre-solve',
    listener: (contact: Contact, oldManifold: Manifold) => void,
  ): World;
  /**
   * This lets you inspect a contact after the solver is finished. This is useful
   * for inspecting impulses. Note: the contact manifold does not include time of
   * impact impulses, which can be arbitrarily large if the sub-step is small.
   * Hence the impulse is provided explicitly in a separate data structure. Note:
   * this is only called for contacts that are touching, solid, and awake.
   *
   * Warning: You cannot create/destroy world entities inside these callbacks.
   */
  on(
    name: 'post-solve',
    listener: (contact: Contact, impulse: ContactImpulse) => void,
  ): World;
  /** Listener is called when a body is removed. */
  on(name: 'remove-body', listener: (body: Body) => void): World;
  /** Listener is called when a fixture is removed implicitly or explicitly. */
  on(name: 'remove-fixture', listener: (fixture: Fixture) => void): World;
  /** Listener is called when a body is added. */
  on(name: 'add-body', listener: (body: Body) => void): World;
  /** Listener is called when a fixture is added. */
  on(name: 'add-fixture', listener: (fixture: Fixture) => void): World;
  /**
   * Register an event listener.
   */
  // tslint:disable-next-line:typedef
  on(name: any, listener: any) {
    if (typeof name !== 'string' || typeof listener !== 'function') {
      return this;
    }

    if (!this._listeners) {
      this._listeners = {};
    }

    if (!this._listeners[name]) {
      this._listeners[name] = [];
    }
    this._listeners[name].push(listener);
    return this;
  }

  /**
   * Remove an event listener.
   */
  // tslint:disable-next-line:typedef

  publish(name: string, arg1?: any, arg2?: any, arg3?: any): number {
    const listeners = this._listeners && this._listeners[name];

    if (!listeners || !listeners.length) {
      return 0;
    }

    for (let l = 0; l < listeners.length; l++) {
      listeners[l].call(this, arg1, arg2, arg3);
    }
    return listeners.length;
  }

  /** @internal */
  beginContact(contact: Contact): void {
    this.publish('begin-contact', contact);
  }

  /** @internal */
  endContact(contact: Contact): void {
    this.publish('end-contact', contact);
  }

  /** @internal */
  preSolve(contact: Contact, oldManifold: Manifold): void {
    this.publish('pre-solve', contact, oldManifold);
  }

  /** @internal */
  postSolve(contact: Contact, impulse: ContactImpulse): void {
    this.publish('post-solve', contact, impulse);
  }

  /**
   * Register a contact filter to provide specific control over collision.
   * Otherwise the default filter is used (defaultFilter). The listener is owned
   * by you and must remain in scope.
   *
   * Moved to Fixture.
   */
}
