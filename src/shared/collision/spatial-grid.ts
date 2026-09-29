import * as Vec from '../vector';
import { AABB, type AABBValue } from './axis-aligned-bounds';

const cellSize = 256;
const aabbExtension = 10;
const aabbMultiplier = 2;

type Group<T> = {
  nodes: Set<SpatialProxy<T>>;
  cellIds: number[];
  bounds: AABB;
};

export class SpatialProxy<T> {
  aabb = new AABB();
  constructor(
    public id: number,
    public userData: T,
    public owner?: unknown,
  ) {}
}

/*
 * Index whole bodies in grid cells, then test their fixture bounds. Fixtures
 * on one body cannot contact each other, so they need no mutual tree searches.
 */
export class SpatialGrid<T> {
  private bodyGroups = new Map<unknown, Group<T>>();
  private gridCells = new Map<number, Set<Group<T>>>();
  private dirty = new Set<Group<T>>();
  private queryScratch: {
    seen: Set<Group<T>>;
    candidates: SpatialProxy<T>[];
  }[] = [];
  private queryDepth = 0;
  private nextId = 0;

  // Hash collisions only add candidates: exact bounds still reject them.
  private cellKeys(box: AABBValue) {
    const keys: number[] = [];

    for (
      let x = Math.floor(box.lowerBound.x / cellSize);
      x <= Math.floor(box.upperBound.x / cellSize);
      x++
    ) {
      for (
        let y = Math.floor(box.lowerBound.y / cellSize);
        y <= Math.floor(box.upperBound.y / cellSize);
        y++
      ) {
        keys.push(Math.imul(x, 0x9e3779b1) ^ y);
      }
    }
    return keys;
  }

  createProxy(box: AABBValue, userData: T, owner?: unknown) {
    const node = new SpatialProxy(++this.nextId, userData, owner);
    let group = this.bodyGroups.get(owner);

    if (!group) {
      group = { nodes: new Set(), cellIds: [], bounds: new AABB() };
      this.bodyGroups.set(owner, group);
    }
    node.aabb.set(box);
    AABB.extend(node.aabb, aabbExtension);
    group.nodes.add(node);
    this.dirty.add(group);
    return node;
  }

  destroyProxy(node: SpatialProxy<T>) {
    const group = this.bodyGroups.get(node.owner)!;

    group.nodes.delete(node);
    this.dirty.add(group);

    if (!group.nodes.size) this.bodyGroups.delete(node.owner);
  }

  moveProxy(node: SpatialProxy<T>, box: AABBValue, displacement: Vec.Value) {
    if (node.aabb.contains(box)) return false;
    node.aabb.set(box);
    AABB.extend(node.aabb, aabbExtension);
    node.aabb.lowerBound.x += Math.min(0, displacement.x * aabbMultiplier);
    node.aabb.lowerBound.y += Math.min(0, displacement.y * aabbMultiplier);
    node.aabb.upperBound.x += Math.max(0, displacement.x * aabbMultiplier);
    node.aabb.upperBound.y += Math.max(0, displacement.y * aabbMultiplier);
    this.dirty.add(this.bodyGroups.get(node.owner)!);
    return true;
  }

  query(
    box: AABBValue,
    callback: (node: SpatialProxy<T>) => boolean,
    owner?: unknown,
  ) {
    this.dirty.forEach((group) => {
      const bounds = group.bounds;

      Vec.setXY(bounds.lowerBound, Infinity, Infinity);
      Vec.setXY(bounds.upperBound, -Infinity, -Infinity);
      // Converting group nodes from Set to Array before use saved ~5% CPU
      [...group.nodes].forEach((node) => bounds.combine(bounds, node.aabb));
      const keys = group.nodes.size ? this.cellKeys(bounds) : [];

      if (
        keys.length === group.cellIds.length &&
        keys.every((key, i) => key === group.cellIds[i])
      ) {
        return;
      }
      group.cellIds.forEach((key) => {
        const cell = this.gridCells.get(key);

        if (!cell) return;

        cell.delete(group);

        if (!cell.size) this.gridCells.delete(key);
      });
      group.cellIds = keys;
      keys.forEach((key) => {
        let cell = this.gridCells.get(key);

        if (!cell) this.gridCells.set(key, (cell = new Set()));
        cell.add(group);
      });
    });
    this.dirty.clear();
    const depth = this.queryDepth++;
    const scratch = (this.queryScratch[depth] ??= {
      seen: new Set<Group<T>>(),
      candidates: [],
    });
    const { seen, candidates } = scratch;
    const ownGroup =
      owner === undefined ? undefined : this.bodyGroups.get(owner);

    try {
      for (
        let x = Math.floor(box.lowerBound.x / cellSize);
        x <= Math.floor(box.upperBound.x / cellSize);
        x++
      ) {
        for (
          let y = Math.floor(box.lowerBound.y / cellSize);
          y <= Math.floor(box.upperBound.y / cellSize);
          y++
        ) {
          const key = Math.imul(x, 0x9e3779b1) ^ y;

          for (const group of this.gridCells.get(key) || []) {
            if (group === ownGroup || seen.has(group)) continue;
            seen.add(group);

            if (!AABB.testOverlap(group.bounds, box)) continue;

            for (const node of group.nodes) {
              if (AABB.testOverlap(node.aabb, box)) candidates.push(node);
            }
          }
        }
      }
      // Collision order must not depend on cells being removed and reinserted.
      candidates.sort((a, b) => a.id - b.id);

      for (const node of candidates) if (callback(node) === false) break;
    } finally {
      seen.clear();
      candidates.length = 0;
      this.queryDepth--;
    }
  }
}
