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

import * as matrix from '../common/physics-matrix';
import { options } from '../utilities/merge-options';

import { AABB } from '../collision/axis-aligned-bounds';
import { Shape, ShapeType } from '../collision/collision-shape';
import { Body, MassData } from './physics-body';
import { BroadPhase } from '../collision/broad-phase';
import { TransformValue } from '../common/physics-transform';

/** @internal */ const _ASSERT = false;

/** @internal */ const synchronize_aabb1 = new AABB();
/** @internal */ const synchronize_aabb2 = new AABB();
/** @internal */ const displacement = matrix.vec2(0, 0);

/**
 * A fixture definition is used to create a fixture. This class defines an
 * abstract fixture definition. You can reuse fixture definitions safely.
 */
export interface FixtureOpt {
  userData?: unknown;
  /**
   * The friction coefficient, usually in the range [0,1]
   */
  friction?: number;
  /**
   * The restitution (elasticity) usually in the range [0,1]
   */
  restitution?: number;
  /**
   * The density, usually in kg/m^2
   */
  density?: number;
  /** Whether collisions involving this fixture apply physical response. */
  physics?: boolean;
  /**
   * Zero, positive or negative collision group.
   * Fixtures with same positive groupIndex always collide and fixtures with same negative groupIndex never collide.
   */
  filterGroupIndex?: number;
  /**
   * Collision category bit or bits that this fixture belongs to.
   * If groupIndex is zero or not matching, then at least one bit in this fixture categoryBits should match other fixture maskBits and vice versa.
   */
  filterCategoryBits?: number;
  /**
   * Collision category bit or bits that this fixture accept for collision.
   */
  filterMaskBits?: number;

  /** Styling for dev-tools. */
}

export interface FixtureDef extends FixtureOpt {
  shape: Shape;
}

/** @internal */ const FixtureDefDefault: FixtureOpt = {
  userData: null,
  friction: 0.2,
  restitution: 0.0,
  density: 0.0,
  physics: true,

  filterGroupIndex: 0,
  filterCategoryBits: 0x0001,
  filterMaskBits: 0xffff,
};

/**
 * This proxy is used internally to connect shape children to the broad-phase.
 */
export class FixtureProxy {
  aabb: AABB;
  fixture: Fixture;
  childIndex: number;
  proxyId: number;
  constructor(fixture: Fixture, childIndex: number) {
    this.aabb = new AABB();
    this.fixture = fixture;
    this.childIndex = childIndex;
    // this.proxyId;
  }
}

/**
 * A fixture is used to attach a shape to a body for collision detection. A
 * fixture inherits its transform from its parent. Fixtures hold additional
 * non-geometric data such as friction, collision filters, etc.
 *
 * To create a new Fixture use {@link Body.createFixture}.
 */
export class Fixture {
  /** @internal */ m_body: Body;
  /** @internal */ m_friction: number;
  /** @internal */ m_restitution: number;
  /** @internal */ m_density: number;
  /** @internal */ m_physics: boolean;
  /** @internal */ m_filterGroupIndex: number;
  /** @internal */ m_filterCategoryBits: number;
  /** @internal */ m_filterMaskBits: number;
  /** @internal */ m_shape: Shape;
  /** @internal */ m_next: Fixture | null;
  /** @internal */ m_proxies: FixtureProxy[];
  // 0 indicates inactive state, this is not the same as m_proxies.length
  /** @internal */ m_proxyCount: number;
  /** @internal */ m_userData: unknown;

  constructor(body: Body, def: FixtureDef);
  constructor(body: Body, shape: Shape, def?: FixtureOpt);
  constructor(body: Body, shape: Shape, density?: number);
  /** @internal */
  constructor(body: Body, shape?: any, def?: any) {
    if (shape.shape) {
      def = shape;
      shape = shape.shape;
    } else if (typeof def === 'number') {
      def = { density: def };
    }

    def = options(def, FixtureDefDefault);

    this.m_body = body;

    this.m_friction = def.friction;
    this.m_restitution = def.restitution;
    this.m_density = def.density;
    this.m_physics = def.physics;

    this.m_filterGroupIndex = def.filterGroupIndex;
    this.m_filterCategoryBits = def.filterCategoryBits;
    this.m_filterMaskBits = def.filterMaskBits;

    // TODO validate shape
    this.m_shape = shape; // .clone();

    this.m_next = null;

    this.m_proxies = [];
    this.m_proxyCount = 0;

    // fixture proxies are created here,
    // but they are activate in when a fixture is added to body
    const childCount = this.m_shape.getChildCount();

    for (let i = 0; i < childCount; ++i) {
      this.m_proxies[i] = new FixtureProxy(this, i);
    }

    this.m_userData = def.userData;
  }

  /**
   * Get the type of the child shape. You can use this to down cast to the
   * concrete shape.
   */
  getType(): ShapeType {
    return this.m_shape.m_type;
  }

  /**
   * Get the child shape. You can modify the child shape, however you should not
   * change the number of vertices because this will crash some collision caching
   * mechanisms. Manipulating the shape may lead to non-physical behavior.
   */
  getShape(): Shape {
    return this.m_shape;
  }

  /** Whether this fixture participates in physical response. */
  hasPhysics(): boolean {
    return this.m_physics;
  }

  // /**
  //  * Get the contact filtering data.
  //  */
  // getFilterData() {
  //   return this.m_filter;
  // }

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
   * Get the next fixture in the parent body's fixture list.
   */
  getNext(): Fixture | null {
    return this.m_next;
  }

  /**
   * Get the coefficient of friction, usually in the range [0,1].
   */
  getFriction(): number {
    return this.m_friction;
  }

  /**
   * Get the coefficient of restitution.
   */
  getRestitution(): number {
    return this.m_restitution;
  }

  /**
   * Get the mass data for this fixture. The mass data is based on the density and
   * the shape. The rotational inertia is about the shape's origin. This operation
   * may be expensive.
   */
  getMassData(massData: MassData): void {
    this.m_shape.computeMass(massData, this.m_density);
  }

  /**
   * Get the fixture's AABB. This AABB may be enlarge and/or stale. If you need a
   * more accurate AABB, compute it using the shape and the body transform.
   */
  getAABB(childIndex: number): AABB {
    if (_ASSERT) {
      console.assert(0 <= childIndex && childIndex < this.m_proxies.length);
    }
    return this.m_proxies[childIndex].aabb;
  }

  /**
   * These support body activation/deactivation.
   */
  createProxies(broadPhase: BroadPhase, xf: TransformValue): void {
    if (_ASSERT) console.assert(this.m_proxyCount == 0);

    // Create proxies in the broad-phase.
    this.m_proxyCount = this.m_shape.getChildCount();

    for (let i = 0; i < this.m_proxyCount; ++i) {
      const proxy = this.m_proxies[i];

      this.m_shape.computeAABB(proxy.aabb, xf, i);
      proxy.proxyId = broadPhase.createProxy(proxy.aabb, proxy);
    }
  }

  destroyProxies(broadPhase: BroadPhase): void {
    // Destroy proxies in the broad-phase.
    for (let i = 0; i < this.m_proxyCount; ++i) {
      const proxy = this.m_proxies[i];

      broadPhase.destroyProxy(proxy.proxyId);
      proxy.proxyId = null;
    }

    this.m_proxyCount = 0;
  }

  /**
   * Updates this fixture proxy in broad-phase (with combined AABB of current and
   * next transformation).
   */
  synchronize(
    broadPhase: BroadPhase,
    xf1: TransformValue,
    xf2: TransformValue,
  ): void {
    for (let i = 0; i < this.m_proxyCount; ++i) {
      const proxy = this.m_proxies[i];

      // Compute an AABB that covers the swept shape (may miss some rotation
      // effect).
      this.m_shape.computeAABB(synchronize_aabb1, xf1, proxy.childIndex);
      this.m_shape.computeAABB(synchronize_aabb2, xf2, proxy.childIndex);

      proxy.aabb.combine(synchronize_aabb1, synchronize_aabb2);

      matrix.subVec2(displacement, xf2.p, xf1.p);

      broadPhase.moveProxy(proxy.proxyId, proxy.aabb, displacement);
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
    if (
      that.m_filterGroupIndex === this.m_filterGroupIndex &&
      that.m_filterGroupIndex !== 0
    ) {
      return that.m_filterGroupIndex > 0;
    }

    const collideA = (that.m_filterMaskBits & this.m_filterCategoryBits) !== 0;
    const collideB = (that.m_filterCategoryBits & this.m_filterMaskBits) !== 0;
    const collide = collideA && collideB;

    return collide;
  }
}
