/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/collision/DynamicTree.ts
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

import { Pool } from '../utilities/object-pool';
import { Vec2Value } from '../vector';
import { AABB, AABBValue } from './axis-aligned-bounds';

const aabbExtension = 10;
const aabbMultiplier = 2;

export type DynamicTreeQueryCallback = (nodeId: number) => boolean;

/**
 * A node in the dynamic tree. The client does not interact with this directly.
 */
export class TreeNode<T> {
  id: number;
  // Enlarged AABB
  aabb: AABB = new AABB();
  userData: T = null;
  parent: TreeNode<T> = null;
  child1: TreeNode<T> = null;
  child2: TreeNode<T> = null;
  // 0: leaf, -1: free node
  height = -1;

  constructor(id?: number) {
    this.id = id;
  }

  isLeaf(): boolean {
    return this.child1 == null;
  }
}

const poolTreeNode = new Pool<TreeNode<any>>({
  create(): TreeNode<any> {
    return new TreeNode();
  },
  release(node: TreeNode<any>) {
    node.userData = null;
    node.parent = null;
    node.child1 = null;
    node.child2 = null;
    node.height = -1;
    node.id = undefined;
  },
});

/**
 * A dynamic AABB tree broad-phase, inspired by Nathanael Presson's btDbvt. A
 * dynamic tree arranges data in a binary tree to accelerate queries such as
 * volume queries and ray casts. Leafs are proxies with an AABB. In the tree we
 * expand the proxy AABB by `aabbExtension` so that the proxy AABB is bigger
 * than the client object. This allows the client object to move by small
 * amounts without triggering a tree update.
 *
 * Nodes are pooled and relocatable, so we use node indices rather than
 * pointers.
 */
export class DynamicTree<T> {
  m_root: TreeNode<T>;
  m_lastProxyId: number;
  m_nodes: {
    [id: number]: TreeNode<T>;
  };

  constructor() {
    this.m_root = null;
    this.m_nodes = {};
    this.m_lastProxyId = 0;
  }

  /**
   * Get proxy user data.
   *
   * @return the proxy user data or 0 if the id is invalid.
   */
  getUserData(id: number): T {
    const node = this.m_nodes[id];

    return node.userData;
  }

  /**
   * Get the fat AABB for a node id.
   *
   * @return the proxy user data or 0 if the id is invalid.
   */
  getFatAABB(id: number): AABB {
    const node = this.m_nodes[id];

    return node.aabb;
  }

  allocateNode(): TreeNode<T> {
    const node = poolTreeNode.allocate();

    node.id = ++this.m_lastProxyId;
    this.m_nodes[node.id] = node;
    return node;
  }

  freeNode(node: TreeNode<T>): void {
    delete this.m_nodes[node.id];
    poolTreeNode.release(node);
  }

  /**
   * Create a proxy in the tree as a leaf node. We return the index of the node
   * instead of a pointer so that we can grow the node pool.
   *
   * Create a proxy. Provide a tight fitting AABB and a userData pointer.
   */
  createProxy(aabb: AABBValue, userData: T): number {
    const node = this.allocateNode();

    node.aabb.set(aabb);

    // Fatten the aabb.
    AABB.extend(node.aabb, aabbExtension);

    node.userData = userData;
    node.height = 0;

    this.insertLeaf(node);

    return node.id;
  }

  /**
   * Destroy a proxy. This asserts if the id is invalid.
   */
  destroyProxy(id: number): void {
    const node = this.m_nodes[id];

    this.removeLeaf(node);
    this.freeNode(node);
  }

  /**
   * Move a proxy with a swepted AABB. If the proxy has moved outside of its
   * fattened AABB, then the proxy is removed from the tree and re-inserted.
   * Otherwise the function returns immediately.
   *
   * @param d Displacement
   *
   * @return true if the proxy was re-inserted.
   */
  moveProxy(id: number, aabb: AABBValue, d: Vec2Value): boolean {
    const node = this.m_nodes[id];

    if (node.aabb.contains(aabb)) {
      return false;
    }

    this.removeLeaf(node);

    node.aabb.set(aabb);

    // Extend AABB.
    aabb = node.aabb;
    AABB.extend(aabb, aabbExtension);

    // Predict AABB displacement.

    if (d.x < 0) {
      aabb.lowerBound.x += d.x * aabbMultiplier;
    } else {
      aabb.upperBound.x += d.x * aabbMultiplier;
    }

    if (d.y < 0) {
      aabb.lowerBound.y += d.y * aabbMultiplier;
    } else {
      aabb.upperBound.y += d.y * aabbMultiplier;
    }

    this.insertLeaf(node);

    return true;
  }

  insertLeaf(leaf: TreeNode<T>): void {
    if (this.m_root == null) {
      this.m_root = leaf;
      this.m_root.parent = null;
      return;
    }

    // Find the best sibling for this node
    const leafAABB = leaf.aabb;
    let index = this.m_root;

    while (!index.isLeaf()) {
      const child1 = index.child1;
      const child2 = index.child2;

      const area = index.aabb.getPerimeter();

      const combinedArea = AABB.combinedPerimeter(index.aabb, leafAABB);

      // Cost of creating a new parent for this node and the new leaf
      const cost = 2 * combinedArea;

      // Minimum cost of pushing the leaf further down the tree
      const inheritanceCost = 2 * (combinedArea - area);

      // Cost of descending into child1
      const newArea1 = AABB.combinedPerimeter(leafAABB, child1.aabb);
      let cost1 = newArea1 + inheritanceCost;

      if (!child1.isLeaf()) {
        const oldArea = child1.aabb.getPerimeter();

        cost1 -= oldArea;
      }

      // Cost of descending into child2
      const newArea2 = AABB.combinedPerimeter(leafAABB, child2.aabb);
      let cost2 = newArea2 + inheritanceCost;

      if (!child2.isLeaf()) {
        const oldArea = child2.aabb.getPerimeter();

        cost2 -= oldArea;
      }

      // Descend according to the minimum cost.
      if (cost < cost1 && cost < cost2) {
        break;
      }

      // Descend
      if (cost1 < cost2) {
        index = child1;
      } else {
        index = child2;
      }
    }

    const sibling = index;

    // Create a new parent.
    const oldParent = sibling.parent;
    const newParent = this.allocateNode();

    newParent.parent = oldParent;
    newParent.userData = null;
    newParent.aabb.combine(leafAABB, sibling.aabb);
    newParent.height = sibling.height + 1;

    if (oldParent != null) {
      // The sibling was not the root.
      if (oldParent.child1 === sibling) {
        oldParent.child1 = newParent;
      } else {
        oldParent.child2 = newParent;
      }

      newParent.child1 = sibling;
      newParent.child2 = leaf;
      sibling.parent = newParent;
      leaf.parent = newParent;
    } else {
      // The sibling was the root.
      newParent.child1 = sibling;
      newParent.child2 = leaf;
      sibling.parent = newParent;
      leaf.parent = newParent;
      this.m_root = newParent;
    }

    // Walk back up the tree fixing heights and AABBs
    index = leaf.parent;

    while (index != null) {
      index = this.balance(index);

      const child1 = index.child1;
      const child2 = index.child2;

      index.height = 1 + Math.max(child1.height, child2.height);
      index.aabb.combine(child1.aabb, child2.aabb);

      index = index.parent;
    }
  }

  removeLeaf(leaf: TreeNode<T>): void {
    if (leaf === this.m_root) {
      this.m_root = null;
      return;
    }

    const parent = leaf.parent;
    const grandParent = parent.parent;
    let sibling;

    if (parent.child1 === leaf) {
      sibling = parent.child2;
    } else {
      sibling = parent.child1;
    }

    if (grandParent != null) {
      // Destroy parent and connect sibling to grandParent.
      if (grandParent.child1 === parent) {
        grandParent.child1 = sibling;
      } else {
        grandParent.child2 = sibling;
      }
      sibling.parent = grandParent;
      this.freeNode(parent);

      // Adjust ancestor bounds.
      let index = grandParent;

      while (index != null) {
        index = this.balance(index);

        const child1 = index.child1;
        const child2 = index.child2;

        index.aabb.combine(child1.aabb, child2.aabb);
        index.height = 1 + Math.max(child1.height, child2.height);

        index = index.parent;
      }
    } else {
      this.m_root = sibling;
      sibling.parent = null;
      this.freeNode(parent);
    }
  }

  /**
   * Perform a left or right rotation if node A is imbalanced. Returns the new
   * root index.
   */
  balance(iA: TreeNode<T>): TreeNode<T> {
    const A = iA;

    if (A.isLeaf() || A.height < 2) {
      return iA;
    }

    const B = A.child1;
    const C = A.child2;

    const balance = C.height - B.height;

    // Rotate C up
    if (balance > 1) {
      const F = C.child1;
      const G = C.child2;

      // Swap A and C
      C.child1 = A;
      C.parent = A.parent;
      A.parent = C;

      // A's old parent should point to C
      if (C.parent != null) {
        if (C.parent.child1 === iA) {
          C.parent.child1 = C;
        } else {
          C.parent.child2 = C;
        }
      } else {
        this.m_root = C;
      }

      // Rotate
      if (F.height > G.height) {
        C.child2 = F;
        A.child2 = G;
        G.parent = A;
        A.aabb.combine(B.aabb, G.aabb);
        C.aabb.combine(A.aabb, F.aabb);

        A.height = 1 + Math.max(B.height, G.height);
        C.height = 1 + Math.max(A.height, F.height);
      } else {
        C.child2 = G;
        A.child2 = F;
        F.parent = A;
        A.aabb.combine(B.aabb, F.aabb);
        C.aabb.combine(A.aabb, G.aabb);

        A.height = 1 + Math.max(B.height, F.height);
        C.height = 1 + Math.max(A.height, G.height);
      }

      return C;
    }

    // Rotate B up
    if (balance < -1) {
      const D = B.child1;
      const E = B.child2;

      // Swap A and B
      B.child1 = A;
      B.parent = A.parent;
      A.parent = B;

      // A's old parent should point to B
      if (B.parent != null) {
        if (B.parent.child1 === A) {
          B.parent.child1 = B;
        } else {
          B.parent.child2 = B;
        }
      } else {
        this.m_root = B;
      }

      // Rotate
      if (D.height > E.height) {
        B.child2 = D;
        A.child1 = E;
        E.parent = A;
        A.aabb.combine(C.aabb, E.aabb);
        B.aabb.combine(A.aabb, D.aabb);

        A.height = 1 + Math.max(C.height, E.height);
        B.height = 1 + Math.max(A.height, D.height);
      } else {
        B.child2 = E;
        A.child1 = D;
        D.parent = A;
        A.aabb.combine(C.aabb, D.aabb);
        B.aabb.combine(A.aabb, E.aabb);

        A.height = 1 + Math.max(C.height, D.height);
        B.height = 1 + Math.max(A.height, E.height);
      }

      return B;
    }

    return A;
  }

  /**
   * Query an AABB for overlapping proxies. The callback class is called for each
   * proxy that overlaps the supplied AABB.
   */
  query(aabb: AABBValue, queryCallback: DynamicTreeQueryCallback): void {
    const stack = this.stackPool.allocate();

    stack.push(this.m_root);

    while (stack.length > 0) {
      const node = stack.pop();

      if (node == null) {
        continue;
      }

      if (AABB.testOverlap(node.aabb, aabb)) {
        if (node.isLeaf()) {
          const proceed = queryCallback(node.id);

          if (proceed === false) {
            return;
          }
        } else {
          stack.push(node.child1);
          stack.push(node.child2);
        }
      }
    }

    this.stackPool.release(stack);
  }

  private stackPool: Pool<Array<TreeNode<T>>> = new Pool<Array<TreeNode<T>>>({
    create(): Array<TreeNode<T>> {
      return [];
    },
    release(stack: Array<TreeNode<T>>): void {
      stack.length = 0;
    },
  });
}
