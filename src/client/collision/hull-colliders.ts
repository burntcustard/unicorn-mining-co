import type { Collider } from './types';

const pieces = new WeakMap<
  Collider,
  { source: number[][][]; colliders: Collider[] }
>();

/*
 * Convex pieces share their hull segment's identity and health. Their bounds
 * use the enclosing segment, while narrow-phase tests use each exact piece.
 */
export const hullColliders = (collider: Collider): Collider[] => {
  const segment = collider.segment!;
  const source = segment.collisionParts as number[][][] | undefined;

  if (!source) return [collider];
  let cached = pieces.get(collider);

  if (!cached || cached.source !== source) {
    cached = {
      source,
      colliders: source.map((points) => ({
        ...collider,
        shapeOutline: points.map(([x, y]) => [
          x - (segment.middle?.[0] || 0),
          y - (segment.middle?.[1] || 0),
        ]),
      })),
    };

    pieces.set(collider, cached);
  }

  for (const part of cached.colliders) {
    const shapeOutline = part.shapeOutline;

    Object.assign(part, collider, { shapeOutline });
  }

  return cached.colliders;
};
