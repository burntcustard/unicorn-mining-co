/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/BroadPhase.ts
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
import { AABB, AABBValue } from './axis-aligned-bounds';
import { DynamicTree } from './dynamic-tree';
import { FixtureProxy } from '../physics/fixture';

/**
 * The broad-phase wraps and extends a dynamic-tree to keep track of moved
 * objects and query them on update.
 */
export class BroadPhase {
  m_tree: DynamicTree<FixtureProxy> = new DynamicTree<FixtureProxy>();
  m_moveBuffer: number[] = [];

  m_callback: (userDataA: any, userDataB: any) => void;
  m_queryProxyId: number;

  /**
   * Test overlap of fat AABBs.
   */
  testOverlap(proxyIdA: number, proxyIdB: number): boolean {
    const aabbA = this.m_tree.getFatAABB(proxyIdA);
    const aabbB = this.m_tree.getFatAABB(proxyIdB);

    return AABB.testOverlap(aabbA, aabbB);
  }

  /**
   * Create a proxy with an initial AABB. Pairs are not reported until UpdatePairs
   * is called.
   */
  createProxy(aabb: AABBValue, userData: FixtureProxy): number {
    const proxyId = this.m_tree.createProxy(aabb, userData);

    this.bufferMove(proxyId);
    return proxyId;
  }

  /**
   * Destroy a proxy. It is up to the client to remove any pairs.
   */
  destroyProxy(proxyId: number): void {
    this.unbufferMove(proxyId);
    this.m_tree.destroyProxy(proxyId);
  }

  /**
   * Call moveProxy as many times as you like, then when you are done call
   * UpdatePairs to finalized the proxy pairs (for your time step).
   */
  moveProxy(proxyId: number, aabb: AABB, displacement: Vec.Value): void {
    const changed = this.m_tree.moveProxy(proxyId, aabb, displacement);

    if (changed) {
      this.bufferMove(proxyId);
    }
  }

  /**
   * Call to trigger a re-processing of it's pairs on the next call to
   * UpdatePairs.
   */

  bufferMove(proxyId: number): void {
    this.m_moveBuffer.push(proxyId);
  }

  unbufferMove(proxyId: number): void {
    for (let i = 0; i < this.m_moveBuffer.length; ++i) {
      if (this.m_moveBuffer[i] === proxyId) {
        this.m_moveBuffer[i] = null;
      }
    }
  }

  /**
   * Update the pairs. This results in pair callbacks. This can only add pairs.
   */
  updatePairs(
    addPairCallback: (userDataA: FixtureProxy, userDataB: FixtureProxy) => void,
  ): void {
    this.m_callback = addPairCallback;

    // Perform tree queries for all moving proxies.
    while (this.m_moveBuffer.length > 0) {
      this.m_queryProxyId = this.m_moveBuffer.pop();

      if (this.m_queryProxyId === null) {
        continue;
      }

      // We have to query the tree with the fat AABB so that
      // we don't fail to create a pair that may touch later.
      const fatAABB = this.m_tree.getFatAABB(this.m_queryProxyId);

      // Query tree, create pairs and add them pair buffer.
      this.m_tree.query(fatAABB, this.queryCallback);
    }
  }

  queryCallback = (proxyId: number): boolean => {
    // A proxy cannot form a pair with itself.
    if (proxyId === this.m_queryProxyId) {
      return true;
    }

    const proxyIdA = Math.min(proxyId, this.m_queryProxyId);
    const proxyIdB = Math.max(proxyId, this.m_queryProxyId);

    const userDataA = this.m_tree.getUserData(proxyIdA);
    const userDataB = this.m_tree.getUserData(proxyIdB);

    // Send the pairs back to the client.
    this.m_callback(userDataA, userDataB);

    return true;
  };
}
