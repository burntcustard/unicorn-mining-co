import { type Pose, type Segment } from '../types';
import { hullSegmentFill } from '../utilities/lighting';
import { drawSegment } from '../utilities/drawing';

/**
 * Stations and fixed structures share the same lit, beveled hull presentation.
 */
export const drawHullSegment = ({
  ctx,
  segment,
  health,
  pose,
}: {
  ctx: CanvasRenderingContext2D;
  segment: Segment;
  health: number;
  pose: Pose;
}) => {
  const worn =
    health < (segment.module.health || segment.module.healthActivated) / 2
      ? 0
      : +!!segment.hull;

  ctx.fillStyle = hullSegmentFill({
    ctx,
    segment,
    worn,
    rotation: pose.rotation,
  });

  ctx.strokeStyle = segment.shades[2];
  drawSegment({ ctx, segment });
};
