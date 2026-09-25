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

import { BroadPhase } from '../collision/broad-phase';
import { Solver, TimeStep } from './physics-solver';
import { Body, BodyDef } from './physics-body';
import { Contact } from './collision-contact';

import { FixtureProxy } from './collision-fixture';

/**
 * Owns rigid bodies, contacts and the continuous collision solver.
 */
export class World {
  m_solver: Solver;
  m_broadPhase: BroadPhase;
  m_contactList: Contact | null;
  m_bodyList: Body | null;
  m_newFixture: boolean;
  m_locked: boolean;

  private preSolveListener?: (contact: Contact) => void;

  constructor() {
    this.s_step = new TimeStep();
    this.m_solver = new Solver(this);
    this.m_broadPhase = new BroadPhase();
    this.m_contactList = null;
    this.m_bodyList = null;
    this.m_newFixture = false;
    this.m_locked = false;
  }

  /**
   * Is the world locked (in the middle of a time step).
   */
  isLocked(): boolean {
    return this.m_locked;
  }

  /**
   * Add a body to the world's linked list.
   */
  _addBody(body: Body): void {
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
  }

  /**
   * Create a rigid body given a definition. No reference to the definition is
   * retained.
   *
   * Bodies and fixtures are changed between physics steps.
   */
  createBody(def: BodyDef): Body {
    if (this.isLocked()) throw new Error('Cannot create a body during a step');
    const body = new Body(this, def);

    this._addBody(body);
    return body;
  }

  /**
   * Destroy a body from the world.
   *
   * Warning: This automatically deletes all associated shapes and contacts.
   *
   * Bodies and fixtures are changed between physics steps.
   */
  destroyBody(b: Body): boolean {
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

    if (b === this.m_bodyList) {
      this.m_bodyList = b.m_next;
    }

    b.m_destroyed = true;

    return true;
  }
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
    velocityIterations: number,
    positionIterations: number,
  ): void {
    // If new fixtures were added, we need to find the new contacts.
    if (this.m_newFixture) {
      this.findNewContacts();
      this.m_newFixture = false;
    }

    this.m_locked = true;

    this.s_step.reset(timeStep);
    this.s_step.velocityIterations = velocityIterations;
    this.s_step.positionIterations = positionIterations;
    this.s_step.blockSolve = true;

    // Update contacts. This is where some contacts are destroyed.
    this.updateContacts();

    // Integrate velocities, solve velocity constraints, and integrate positions.
    if (timeStep > 0) {
      this.m_solver.solveWorld(this.s_step);

      // Synchronize fixtures, check for out of range bodies.
      for (let b = this.m_bodyList; b; b = b.m_next) {
        // If a body was not in an island then it did not move.
        if (!b.m_islandFlag) {
          continue;
        }

        // Update fixtures (for broad-phase).
        b.synchronizeFixtures();
      }
      // Look for new contacts.
      this.findNewContacts();
    }

    // Handle TOI events.
    if (timeStep > 0) {
      this.m_solver.solveWorldTOI(this.s_step);
    }

    this.m_locked = false;
  }

  /**
   * Call this method to find new contacts.
   */
  findNewContacts(): void {
    this.m_broadPhase.updatePairs(
      (proxyA: FixtureProxy, proxyB: FixtureProxy) =>
        this.createContact(proxyA, proxyB),
    );
  }

  /**
   * Callback for broad-phase.
   */
  createContact(proxyA: FixtureProxy, proxyB: FixtureProxy): void {
    const fixtureA = proxyA.fixture;
    const fixtureB = proxyB.fixture;

    const bodyA = fixtureA.getBody();
    const bodyB = fixtureB.getBody();

    // Are the fixtures on the same body?
    if (bodyA === bodyB) {
      return;
    }

    // Does a contact already exist?
    let edge = bodyB.getContactList();

    // ContactEdge
    while (edge) {
      if (edge.other === bodyA) {
        const fA = edge.contact.getFixtureA();
        const fB = edge.contact.getFixtureB();

        if (fA === fixtureA && fB === fixtureB) {
          // A contact already exists.
          return;
        }

        if (fA === fixtureB && fB === fixtureA) {
          // A contact already exists.
          return;
        }
      }

      edge = edge.next;
    }

    if (!bodyB.shouldCollide(bodyA)) {
      return;
    }

    if (!fixtureB.shouldCollide(fixtureA)) {
      return;
    }

    // Call the factory.
    const contact = Contact.create(fixtureA, fixtureB);

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
  }

  /**
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
      const bodyA = fixtureA.getBody();
      const bodyB = fixtureB.getBody();

      const activeA = bodyA.isAwake();
      const activeB = bodyB.isAwake();

      // At least one body must be awake.
      if (!activeA && !activeB) {
        continue;
      }

      const proxyIdA = fixtureA.m_proxy.proxyId;
      const proxyIdB = fixtureB.m_proxy.proxyId;
      const overlap = this.m_broadPhase.testOverlap(proxyIdA, proxyIdB);

      // Here we destroy contacts that cease to overlap in the broad-phase.
      if (!overlap) {
        this.destroyContact(c);
        continue;
      }

      // The contact persists.
      c.update(this);
    }
  }
  destroyContact(contact: Contact): void {
    // Remove from the world.
    if (contact.m_prev) {
      contact.m_prev.m_next = contact.m_next;
    }

    if (contact.m_next) {
      contact.m_next.m_prev = contact.m_prev;
    }

    if (contact === this.m_contactList) {
      this.m_contactList = contact.m_next;
    }

    Contact.destroy(contact);
  }

  /**
   * Register the game's contact callback. Swept and ordinary contacts use it.
   */
  onPreSolve(listener: (contact: Contact) => void): void {
    this.preSolveListener = listener;
  }
  preSolve(contact: Contact): void {
    this.preSolveListener?.(contact);
  }
}
