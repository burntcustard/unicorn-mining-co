/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/dynamics/Solver.ts
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

import * as Vec from '../vector';
import { linearSlop } from '../settings';
import { Body } from './body';
import type { Contact } from './contact';
import {
  findTimeOfImpact,
  type TOIInput,
  type TOIOutput,
} from '../collision/time-of-impact';
import { DistanceProxy } from '../collision/shape-distance';
import { World } from './world';
import { Sweep } from './motion-sweep';

const maxTOISubsteps = 8;
const toiEndTolerance = 1e-8;
const maxTranslation = 200;
const maxTranslationSquared = maxTranslation * maxTranslation;
const maxRotation = 0.5 * Math.PI;
const maxRotationSquared = maxRotation * maxRotation;

export class TimeStep {
  // time step
  dt = 0;
  velocityIterations = 0;
  positionIterations = 0;
}

// reuse
const s_subStep = new TimeStep();
const c = Vec.create();
const v = Vec.create();
const translation = Vec.create();
const input: TOIInput = {
  proxyA: new DistanceProxy(),
  proxyB: new DistanceProxy(),
  sweepA: new Sweep(),
  sweepB: new Sweep(),
  tMax: 1,
};
const output: TOIOutput = { touching: false, t: -1 };
const backup = new Sweep();
const backup1 = new Sweep();
const backup2 = new Sweep();

/**
 * Finds and solves islands. An island is a connected subset of the world.
 */
export class Solver {
  m_world: World;
  m_stack: Body[];
  m_bodies: Body[];
  m_contacts: Contact[];

  constructor(world: World) {
    this.m_world = world;
    this.m_stack = [];
    this.m_bodies = [];
    this.m_contacts = [];
  }

  clear(): void {
    this.m_stack.length = 0;
    this.m_bodies.length = 0;
    this.m_contacts.length = 0;
  }

  addBody(body: Body): void {
    this.m_bodies.push(body);
  }

  addContact(contact: Contact): void {
    this.m_contacts.push(contact);
  }

  solveWorld(step: TimeStep): void {
    const world = this.m_world;

    // Clear all the island flags.
    for (let b = world.m_bodyList; b; b = b.m_next) {
      b.m_islandFlag = false;
    }

    for (let c = world.m_contactList; c; c = c.m_next) {
      c.m_islandFlag = false;
    }

    // Build and simulate all islands.
    const stack = this.m_stack;

    for (let seed = world.m_bodyList; seed; seed = seed.m_next) {
      if (seed.m_islandFlag) {
        continue;
      }

      // Reset island and stack.
      this.clear();

      stack.push(seed);

      seed.m_islandFlag = true;

      // Perform a depth first search (DFS) on the constraint graph.
      while (stack.length > 0) {
        // Grab the next body off the stack and add it to the island.
        const b = stack.pop();

        this.addBody(b);

        // Search all contacts connected to this body.
        for (let ce = b.m_contactList; ce; ce = ce.next) {
          const contact = ce.contact;

          // Has this contact already been added to an island?
          if (contact.m_islandFlag) {
            continue;
          }

          // Is this contact solid and touching?
          if (!contact.isEnabled() || !contact.isTouching()) {
            continue;
          }

          // Detection runs for every contact; only physical pairs enter the solver.
          if (
            !contact.m_fixtureA.hasPhysics() ||
            !contact.m_fixtureB.hasPhysics()
          ) {
            continue;
          }

          this.addContact(contact);
          contact.m_islandFlag = true;

          const other = ce.other;

          // Was the other body already added to this island?
          if (other.m_islandFlag) {
            continue;
          }
          stack.push(other);
          other.m_islandFlag = true;
        }
      }

      this.solveIsland(step);
    }
  }

  solveIsland(step: TimeStep): void {
    // B2: Island Solve
    const h = step.dt;

    // Integrate velocities and apply damping. Initialize the body state.
    for (let i = 0; i < this.m_bodies.length; ++i) {
      const body = this.m_bodies[i];

      Vec.set(c, body.m_sweep.c);
      const a = body.m_sweep.a;

      Vec.set(v, body.m_linearVelocity);
      let w = body.m_angularVelocity;

      // Store positions for continuous collision.
      Vec.set(body.m_sweep.c0, body.m_sweep.c);
      body.m_sweep.a0 = body.m_sweep.a;

      Vec.set(body.c_position.c, c);
      body.c_position.a = a;
      Vec.set(body.c_velocity.v, v);
      body.c_velocity.w = w;
    }

    for (let i = 0; i < this.m_contacts.length; ++i) {
      const contact = this.m_contacts[i];

      contact.initConstraint();
    }

    for (let i = 0; i < this.m_contacts.length; ++i) {
      const contact = this.m_contacts[i];

      contact.initVelocityConstraint();
    }

    // Solve velocity constraints
    for (let i = 0; i < step.velocityIterations; ++i) {
      for (let j = 0; j < this.m_contacts.length; ++j) {
        const contact = this.m_contacts[j];

        contact.solveVelocityConstraint();
      }
    }

    // Integrate positions
    for (let i = 0; i < this.m_bodies.length; ++i) {
      const body = this.m_bodies[i];

      Vec.set(c, body.c_position.c);
      let a = body.c_position.a;

      Vec.set(v, body.c_velocity.v);
      let w = body.c_velocity.w;

      // Check for large velocities
      Vec.scale(v, h, translation);
      const translationLengthSqr = Vec.lengthSquared(translation);

      if (translationLengthSqr > maxTranslationSquared) {
        const ratio = maxTranslation / Math.sqrt(translationLengthSqr);

        Vec.scale(v, ratio, v);
      }

      const rotation = h * w;

      if (rotation * rotation > maxRotationSquared) {
        const ratio = maxRotation / Math.abs(rotation);

        w *= ratio;
      }

      // Integrate
      Vec.addScaled(c, v, h, c);
      a += h * w;

      Vec.set(body.c_position.c, c);
      body.c_position.a = a;
      Vec.set(body.c_velocity.v, v);
      body.c_velocity.w = w;
    }

    // Solve position constraints

    for (let i = 0; i < step.positionIterations; ++i) {
      let minSeparation = 0;

      for (let j = 0; j < this.m_contacts.length; ++j) {
        const contact = this.m_contacts[j];
        const separation = contact.solvePositionConstraint();

        minSeparation = Math.min(minSeparation, separation);
      }
      // We can't expect minSpeparation >= -linearSlop because we don't
      // push the separation above -linearSlop.
      const contactsOkay = minSeparation >= -3 * linearSlop;

      if (contactsOkay) {
        // Exit early if the position errors are small.
        break;
      }
    }

    // Copy state buffers back to the bodies
    for (let i = 0; i < this.m_bodies.length; ++i) {
      const body = this.m_bodies[i];

      Vec.set(body.m_sweep.c, body.c_position.c);
      body.m_sweep.a = body.c_position.a;
      Vec.set(body.m_linearVelocity, body.c_velocity.v);
      body.m_angularVelocity = body.c_velocity.w;
      body.synchronizeTransform();
    }
  }

  /**
   * Find TOI contacts and solve them.
   */
  solveWorldTOI(step: TimeStep): void {
    const world = this.m_world;

    for (let b = world.m_bodyList; b; b = b.m_next) {
      b.m_islandFlag = false;
      b.m_sweep.alpha0 = 0;
    }

    for (let c = world.m_contactList; c; c = c.m_next) {
      c.m_toiFlag = false;
      c.m_islandFlag = false;
      c.m_toiCount = 0;
      c.m_toi = 1;
    }

    // Find TOI events and solve them.
    for (;;) {
      // Find the first TOI.
      let minContact: Contact | null = null;
      let minAlpha = 1;

      for (let c = world.m_contactList; c; c = c.m_next) {
        // Is this contact disabled?
        if (!c.isEnabled()) {
          continue;
        }

        // Prevent excessive sub-stepping.
        if (c.m_toiCount > maxTOISubsteps) {
          continue;
        }

        let alpha = 1;

        if (c.m_toiFlag) {
          // This contact has a valid cached TOI.
          alpha = c.m_toi;
        } else {
          const fA = c.getFixtureA();
          const fB = c.getFixtureB();

          const bA = fA.getBody();
          const bB = fB.getBody();

          // Compute the TOI for this contact.
          // Put the sweeps onto the same time interval.
          let alpha0 = bA.m_sweep.alpha0;

          if (bA.m_sweep.alpha0 < bB.m_sweep.alpha0) {
            alpha0 = bB.m_sweep.alpha0;
            bA.m_sweep.advance(alpha0);
          } else if (bB.m_sweep.alpha0 < bA.m_sweep.alpha0) {
            alpha0 = bA.m_sweep.alpha0;
            bB.m_sweep.advance(alpha0);
          }

          // Compute the time of impact in interval [0, minTOI]
          fA.getShape().computeDistanceProxy(input.proxyA);
          fB.getShape().computeDistanceProxy(input.proxyB);
          input.sweepA.set(bA.m_sweep);
          input.sweepB.set(bB.m_sweep);
          input.tMax = 1;

          findTimeOfImpact(output, input);

          // Beta is the fraction of the remaining portion of the [time?].
          const beta = output.t;

          if (output.touching) {
            alpha = Math.min(alpha0 + (1 - alpha0) * beta, 1);
          } else {
            alpha = 1;
          }

          c.m_toi = alpha;
          c.m_toiFlag = true;
        }

        if (alpha < minAlpha) {
          // This is the minimum TOI found so far.
          minContact = c;
          minAlpha = alpha;
        }
      }

      if (minContact == null || 1 - toiEndTolerance < minAlpha) {
        // No more TOI events. Done!
        break;
      }

      // Advance the bodies to the TOI.
      const fA = minContact.getFixtureA();
      const fB = minContact.getFixtureB();
      const bA = fA.getBody();
      const bB = fB.getBody();

      backup1.set(bA.m_sweep);
      backup2.set(bB.m_sweep);

      bA.advance(minAlpha);
      bB.advance(minAlpha);

      // The TOI contact likely has some new contact points.
      minContact.update(world);
      minContact.m_toiFlag = false;
      ++minContact.m_toiCount;

      // Is the contact solid?
      if (!minContact.isEnabled() || !minContact.isTouching()) {
        // Restore the sweeps.
        minContact.setEnabled(false);
        bA.m_sweep.set(backup1);
        bB.m_sweep.set(backup2);
        bA.synchronizeTransform();
        bB.synchronizeTransform();
        continue;
      }

      if (!fA.hasPhysics() || !fB.hasPhysics()) {
        // Keep the reported time-of-impact contact, then allow both bodies to
        // continue along their original paths without an impulse.
        minContact.m_toi = 1;
        minContact.m_toiFlag = true;
        bA.m_sweep.set(backup1);
        bB.m_sweep.set(backup2);
        bA.synchronizeTransform();
        bB.synchronizeTransform();
        continue;
      }

      // Build the island
      this.clear();
      this.addBody(bA);
      this.addBody(bB);
      this.addContact(minContact);

      bA.m_islandFlag = true;
      bB.m_islandFlag = true;
      minContact.m_islandFlag = true;

      // Get contacts on bodyA and bodyB.
      const bodies = [bA, bB];

      for (let i = 0; i < bodies.length; ++i) {
        const body = bodies[i];

        for (let ce = body.m_contactList; ce; ce = ce.next) {
          const contact = ce.contact;

          // Has this contact already been added to the island?
          if (contact.m_islandFlag) {
            continue;
          }

          const other = ce.other;

          if (
            !contact.m_fixtureA.hasPhysics() ||
            !contact.m_fixtureB.hasPhysics()
          ) {
            continue;
          }

          // Tentatively advance the body to the TOI.
          backup.set(other.m_sweep);

          if (!other.m_islandFlag) {
            other.advance(minAlpha);
          }

          // Update the contact points
          contact.update(world);

          // Was the contact disabled by the user?
          // Are there contact points?
          if (!contact.isEnabled() || !contact.isTouching()) {
            other.m_sweep.set(backup);
            other.synchronizeTransform();
            continue;
          }

          // Add the contact to the island
          contact.m_islandFlag = true;
          this.addContact(contact);

          // Has the other body already been added to the island?
          if (other.m_islandFlag) {
            continue;
          }

          // Add the other body to the island.
          other.m_islandFlag = true;

          this.addBody(other);
        }
      }

      s_subStep.dt = (1 - minAlpha) * step.dt;
      s_subStep.positionIterations = 20;
      s_subStep.velocityIterations = step.velocityIterations;

      this.solveIslandTOI(s_subStep, bA, bB);

      // Reset island flags and synchronize broad-phase proxies.
      for (let i = 0; i < this.m_bodies.length; ++i) {
        const body = this.m_bodies[i];

        body.m_islandFlag = false;

        body.synchronizeFixtures();

        // Invalidate all contact TOIs on this displaced body.
        for (let ce = body.m_contactList; ce; ce = ce.next) {
          ce.contact.m_toiFlag = false;
          ce.contact.m_islandFlag = false;
        }
      }

      // Commit fixture proxy movements to the broad-phase so that new contacts
      // are created.
      // Also, some contacts can be destroyed.
      world.findNewContacts();
    }
  }

  solveIslandTOI(subStep: TimeStep, toiA: Body, toiB: Body): void {
    // Initialize the body state.
    for (let i = 0; i < this.m_bodies.length; ++i) {
      const body = this.m_bodies[i];

      Vec.set(body.c_position.c, body.m_sweep.c);
      body.c_position.a = body.m_sweep.a;
      Vec.set(body.c_velocity.v, body.m_linearVelocity);
      body.c_velocity.w = body.m_angularVelocity;
    }

    for (let i = 0; i < this.m_contacts.length; ++i) {
      const contact = this.m_contacts[i];

      contact.initConstraint();
    }

    // Solve position constraints.
    for (let i = 0; i < subStep.positionIterations; ++i) {
      let minSeparation = 0;

      for (let j = 0; j < this.m_contacts.length; ++j) {
        const contact = this.m_contacts[j];
        const separation = contact.solvePositionConstraintTOI(toiA, toiB);

        minSeparation = Math.min(minSeparation, separation);
      }
      // We can't expect minSpeparation >= -linearSlop because we don't
      // push the separation above -linearSlop.
      const contactsOkay = minSeparation >= -1.5 * linearSlop;

      if (contactsOkay) {
        break;
      }
    }

    // Leap of faith to new safe state.
    Vec.set(toiA.m_sweep.c0, toiA.c_position.c);
    toiA.m_sweep.a0 = toiA.c_position.a;
    Vec.set(toiB.m_sweep.c0, toiB.c_position.c);
    toiB.m_sweep.a0 = toiB.c_position.a;

    // No warm starting is needed for TOI events because warm
    // starting impulses were applied in the discrete solver.
    for (let i = 0; i < this.m_contacts.length; ++i) {
      const contact = this.m_contacts[i];

      contact.initVelocityConstraint();
    }

    // Solve velocity constraints.
    for (let i = 0; i < subStep.velocityIterations; ++i) {
      for (let j = 0; j < this.m_contacts.length; ++j) {
        const contact = this.m_contacts[j];

        contact.solveVelocityConstraint();
      }
    }

    // Don't store the TOI contact forces for warm starting
    // because they can be quite large.

    const h = subStep.dt;

    // Integrate positions
    for (let i = 0; i < this.m_bodies.length; ++i) {
      const body = this.m_bodies[i];

      Vec.set(c, body.c_position.c);
      let a = body.c_position.a;

      Vec.set(v, body.c_velocity.v);
      let w = body.c_velocity.w;

      // Check for large velocities
      Vec.scale(v, h, translation);
      const translationLengthSqr = Vec.lengthSquared(translation);

      if (translationLengthSqr > maxTranslationSquared) {
        const ratio = maxTranslation / Math.sqrt(translationLengthSqr);

        Vec.scale(v, ratio, v);
      }

      const rotation = h * w;

      if (rotation * rotation > maxRotationSquared) {
        const ratio = maxRotation / Math.abs(rotation);

        w *= ratio;
      }

      // Integrate
      Vec.addScaled(c, v, h, c);
      a += h * w;

      Vec.set(body.c_position.c, c);
      body.c_position.a = a;
      Vec.set(body.c_velocity.v, v);
      body.c_velocity.w = w;

      // Sync bodies
      Vec.set(body.m_sweep.c, c);
      body.m_sweep.a = a;
      Vec.set(body.m_linearVelocity, v);
      body.m_angularVelocity = w;
      body.synchronizeTransform();
    }
  }
}
