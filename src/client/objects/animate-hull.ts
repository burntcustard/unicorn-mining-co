import type { Craft } from './craft';
import type { HullSegmentPlan } from './hull-segments';
import type { HullSegmentSpecification } from '../../specs/ships/types';
import { simulationStep } from '../../specs/simulation';
import { rotatePoint, shapeOf } from '../utilities/geometry';
import * as Vec from '../utilities/vector';
import { updateHullRibbons } from './hull-ribbons';

const frames = new WeakMap<
  Craft,
  { time: number; segments: Craft['segments'] }
>();

/*
 * Evaluate a small joint hierarchy from simulation time. Rendering, collision,
 * prediction and the server all use the same phase; no per-frame packets.
 */
export const animateHull = (craft: Craft) => {
  if (!craft.hullAnimation) return;
  const time = (craft.world?.tick || 0) * simulationStep;

  const frame = frames.get(craft);

  if (frame?.time === time && frame.segments === craft.segments) return;
  frames.set(craft, { time, segments: craft.segments });

  const poses = new Map<
    HullSegmentPlan,
    { position: Vec.Value; rotation: number }
  >();

  const poseOf = (
    plan: HullSegmentPlan,
  ): { position: Vec.Value; rotation: number } => {
    const cached = poses.get(plan);

    if (cached) return cached;
    const animation = plan.animation as HullSegmentSpecification['animation'];
    const parent =
      animation?.parent !== undefined
        ? poseOf(craft.hullSegments[animation.parent])
        : { position: Vec.create(), rotation: 0 };
    const pivot = Vec.create(...(animation?.pivot || [0, 0]));
    const rotation =
      parent.rotation +
      (animation
        ? Math.sin((time * Math.PI * 2) / 1.8 + animation.phase) *
          animation.amplitude
        : 0);
    const position = Vec.subtract(
      Vec.add(parent.position, rotatePoint(pivot, parent.rotation)),
      rotatePoint(pivot, rotation),
    );
    const pose = { position, rotation };

    poses.set(plan, pose);
    return pose;
  };

  for (const segment of craft.segments) {
    const plan = segment.module as HullSegmentPlan;

    if (!segment.hull || !plan.animation) continue;
    const pose = poseOf(plan);

    const transform = (points: number[][]) =>
      points.map((point) => {
        const result: number[] = [];

        for (let index = 0; index < point.length; index += 2) {
          const at = Vec.add(
            pose.position,
            rotatePoint(
              Vec.create(point[index], point[index + 1]),
              pose.rotation,
            ),
          );

          result.push(at.x, at.y);
        }

        return result;
      });

    segment.points = transform(plan.points as number[][]);
    Object.assign(segment, shapeOf(segment.points));
    segment.curvePoints = plan.curvePoints && transform(plan.curvePoints);
    segment.collisionParts = plan.collisionParts?.map(transform);

    segment.decorations = plan.decorations?.map(
      (decoration: { points: number[][]; color: string }) => ({
        ...decoration,
        points: transform(decoration.points),
      }),
    );
  }

  updateHullRibbons(craft);
};
