/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/dynamics/Fixture.ts
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

import { AABB } from '../collision/axis-aligned-bounds';
import { collidersCanContact, type Collider } from '../collision/types';
import { Shape } from '../collision/shape/base';
import { Body } from './body';
import { BroadPhase } from '../collision/broad-phase';
import { type SpatialProxy } from '../collision/spatial-grid';
import { type TransformValue } from '../vector-math';

const synchronize_aabb1 = new AABB();
const synchronize_aabb2 = new AABB();
const displacement = Vec.create();

/**
 * A fixture definition is used to create a fixture. This class defines an
 * abstract fixture definition. You can reuse fixture definitions safely.
 */
export interface FixtureOpt {
  userData?: unknown;
  // Whether collisions involving this fixture apply physical response.
  physics?: boolean;
}

/**
 * A fixture is used to attach a shape to a body for collision detection. A
 * fixture inherits its transform from its parent. Fixtures hold additional
 * non-geometric data such as physical-response flags and collider data.
 *
 * To create a new Fixture use {@link Body.createFixture}.
 */
export class Fixture {
  m_body: Body;
  m_physics: boolean;
  m_shape: Shape;
  m_next: Fixture | null;
  m_proxy: SpatialProxy<Fixture> | null = null;
  private m_aabb = new AABB();
  m_userData: unknown;
  proxyMargin = 0;

  constructor(body: Body, shape: Shape, definition: FixtureOpt) {
    this.m_body = body;
    this.m_physics = definition.physics ?? true;
    this.m_shape = shape;
    this.m_next = null;
    this.m_userData = definition.userData;
  }

  /**
   * Get the child shape. You can modify the child shape, however you should not
   * change the number of vertices because this will crash some collision caching
   * mechanisms. Manipulating the shape may lead to non-physical behavior.
   */
  getShape(): Shape {
    return this.m_shape;
  }

  /**
   * Whether this fixture participates in physical response.
   */
  hasPhysics(): boolean {
    return this.m_physics;
  }

  /**
   * Get the user data that was assigned in the fixture definition. Use this to
   * store your application specific data.
   */
  getUserData(): unknown {
    return this.m_userData;
  }

  /**
   * Set the user data. Use this to store your application specific data.
   */
  setUserData(data: unknown): void {
    this.m_userData = data;
  }

  /**
   * Get the parent body of this fixture. This is null if the fixture is not
   * attached.
   */
  getBody(): Body {
    return this.m_body;
  }

  /**
   * These support body activation/deactivation.
   */
  createProxies(broadPhase: BroadPhase, xf: TransformValue): void {
    this.m_shape.computeAABB(this.m_aabb, xf);
    this.m_proxy = broadPhase.createProxy(this.m_aabb, this);
  }

  destroyProxies(broadPhase: BroadPhase): void {
    const proxy = this.m_proxy;

    if (!proxy) return;
    broadPhase.destroyProxy(proxy);
    this.m_proxy = null;
  }

  /**
   * Update this fixture's broadphase proxy across the swept shape.
   */
  synchronize(
    broadPhase: BroadPhase,
    xf1: TransformValue,
    xf2: TransformValue,
    motion = Infinity,
  ): void {
    const proxy = this.m_proxy;

    if (!proxy) return;

    if (motion < this.proxyMargin) return;

    // Combine starting and ending bounds for swept broadphase detection.
    if (
      xf1 === xf2 ||
      (xf1.p.x === xf2.p.x &&
        xf1.p.y === xf2.p.y &&
        xf1.q.s === xf2.q.s &&
        xf1.q.c === xf2.q.c)
    ) {
      this.m_shape.computeAABB(this.m_aabb, xf1);
    } else {
      this.m_shape.computeAABB(synchronize_aabb1, xf1);
      this.m_shape.computeAABB(synchronize_aabb2, xf2);
      this.m_aabb.combine(synchronize_aabb1, synchronize_aabb2);
    }

    Vec.subtract(xf2.p, xf1.p, displacement);
    broadPhase.moveProxy(proxy, this.m_aabb, displacement);

    if (motion < Infinity) {
      const fat = proxy.aabb;
      const box = this.m_aabb;

      this.proxyMargin =
        motion +
        0.9 *
          Math.min(
            box.lowerBound.x - fat.lowerBound.x,
            box.lowerBound.y - fat.lowerBound.y,
            fat.upperBound.x - box.upperBound.x,
            fat.upperBound.y - box.upperBound.y,
          );
    }
  }

  /**
   * Implement this method to provide collision filtering, if you want finer
   * control over contact creation.
   *
   * Return true if contact calculations should be performed between these two
   * fixtures.
   *
   * Warning: for performance reasons this is only called when the AABBs begin to
   * overlap.
   */
  shouldCollide(that: Fixture): boolean {
    const a = this.m_userData as Collider | undefined;
    const b = that.m_userData as Collider | undefined;

    return !a || !b || collidersCanContact(a, b);
  }
}
