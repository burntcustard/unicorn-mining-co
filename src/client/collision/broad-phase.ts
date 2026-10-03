import * as Vec from '../utilities/vector';
import { AABB, AABBValue } from './axis-aligned-bounds';
import { SpatialGrid, type SpatialProxy } from './spatial-grid';
import { Fixture } from '../physics/fixture';

/**
 * The broad-phase tracks moved fixtures and queries their spatial grid.
 */
export class BroadPhase {
  m_callback: (userDataA: any, userDataB: any) => void;
  m_grid: SpatialGrid<Fixture> = new SpatialGrid<Fixture>();
  m_moveBuffer: SpatialProxy<Fixture>[] = [];
  m_queryProxy: SpatialProxy<Fixture>;
  queryCallback = (proxyId: SpatialProxy<Fixture>): boolean => {
    // A proxy cannot form a pair with itself.
    if (proxyId === this.m_queryProxy) {
      return true;
    }

    const proxyIdA =
      proxyId.id < this.m_queryProxy.id ? proxyId : this.m_queryProxy;
    const proxyIdB =
      proxyId.id < this.m_queryProxy.id ? this.m_queryProxy : proxyId;

    const userDataA = proxyIdA.userData;
    const userDataB = proxyIdB.userData;

    // Send the pairs back to the client.
    this.m_callback(userDataA, userDataB);

    return true;
  };

  /**
   * Call to trigger a re-processing of it's pairs on the next call to
   * UpdatePairs.
   */

  bufferMove(proxyId: SpatialProxy<Fixture>): void {
    this.m_moveBuffer.push(proxyId);
  }

  /**
   * Create a proxy with an initial AABB. Pairs are not reported until UpdatePairs
   * is called.
   */
  createProxy(aabb: AABBValue, userData: Fixture): SpatialProxy<Fixture> {
    const proxyId = this.m_grid.createProxy(aabb, userData, userData.m_body);

    this.bufferMove(proxyId);
    return proxyId;
  }

  /**
   * Destroy a proxy. It is up to the client to remove any pairs.
   */
  destroyProxy(proxyId: SpatialProxy<Fixture>): void {
    this.unbufferMove(proxyId);
    this.m_grid.destroyProxy(proxyId);
  }

  /**
   * Call moveProxy as many times as you like, then when you are done call
   * UpdatePairs to finalized the proxy pairs (for your time step).
   */
  moveProxy(
    proxyId: SpatialProxy<Fixture>,
    aabb: AABB,
    displacement: Vec.Value,
  ): void {
    const changed = this.m_grid.moveProxy(proxyId, aabb, displacement);

    if (changed) {
      this.bufferMove(proxyId);
    }
  }

  /**
   * Test overlap of fat AABBs.
   */
  testOverlap(
    proxyIdA: SpatialProxy<Fixture>,
    proxyIdB: SpatialProxy<Fixture>,
  ): boolean {
    const aabbA = proxyIdA.aabb;
    const aabbB = proxyIdB.aabb;

    return AABB.testOverlap(aabbA, aabbB);
  }

  unbufferMove(proxyId: SpatialProxy<Fixture>): void {
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
    addPairCallback: (userDataA: Fixture, userDataB: Fixture) => void,
  ): void {
    this.m_callback = addPairCallback;

    // Perform grid queries for all moving proxies.
    while (this.m_moveBuffer.length > 0) {
      this.m_queryProxy = this.m_moveBuffer.pop();

      if (this.m_queryProxy === null) {
        continue;
      }

      // We have to query the grid with the fat AABB so that
      // we don't fail to create a pair that may touch later.
      const fatAABB = this.m_queryProxy.aabb;

      // Query the grid and create contacts.
      this.m_grid.query(fatAABB, this.queryCallback, this.m_queryProxy.owner);
    }
  }
}
