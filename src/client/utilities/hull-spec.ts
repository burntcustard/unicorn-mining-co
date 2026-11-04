import type { HullSegmentSpecification } from '../../specs/ships/types';
import { sampleOutline } from './curves';
import { convexParts } from './triangulate';
import { polygonCutouts } from './polygon-cutouts';

const prepared = new WeakMap<
  HullSegmentSpecification,
  HullSegmentSpecification
>();

/*
 * Keep authored curves for drawing and derive convex collision pieces once.
 * The catalog generator uses this same conversion for the Go server.
 */
export const prepareHull = (plan: HullSegmentSpecification) => {
  const cached = prepared.get(plan);

  if (cached) return cached;
  const geometry = plan.cutouts?.length
    ? polygonCutouts(plan.curvePoints || plan.points, plan.cutouts)
    : undefined;
  const curvePoints = geometry?.curvePoints || plan.curvePoints;
  const points = curvePoints ? sampleOutline(curvePoints) : plan.points;
  const collisionParts =
    plan.collisionParts || (curvePoints && convexParts(points));

  if (geometry && !collisionParts) {
    throw new Error('Invalid hull cutout geometry');
  }

  const result = {
    ...plan,
    points,
    curvePoints,
    collisionParts,
    ...(geometry && {
      shapeOutline: geometry.shapeOutline,
      stroke: geometry.shapeOutline,
    }),
  };

  prepared.set(plan, result);
  return result;
};
