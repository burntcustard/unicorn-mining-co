import * as Vec from '../vector';
import { type Pose } from '../types';

type MotionPose = Pose & { velocity?: Vec.Value; spin?: number };

// Monotone Hermite tangents smooth acceleration without overshooting either
// endpoint, including a velocity reversal at a collision or an abrupt stop.
export const interpolatePose = ({
  from,
  to,
  fraction,
  dt,
}: {
  from: MotionPose;
  to: MotionPose;
  fraction: number;
  dt: number;
}) => {
  const t = fraction;
  const coordinate = (
    start: number,
    end: number,
    before?: number,
    after?: number,
  ) => {
    const delta = end - start;

    if (!delta || (!before && !after)) {
      return start + delta * t;
    }
    const tangent = (velocity = 0) =>
      delta * Math.max(0, Math.min(3, (velocity * dt) / delta));

    return (
      start +
      delta * t * t * (3 - 2 * t) +
      t * (1 - t) * ((1 - t) * tangent(before) - t * tangent(after))
    );
  };
  const turn = Math.atan2(
    Math.sin(to.rotation - from.rotation),
    Math.cos(to.rotation - from.rotation),
  );

  return {
    position: Vec.create(
      coordinate(
        from.position.x,
        to.position.x,
        from.velocity?.x,
        to.velocity?.x,
      ),
      coordinate(
        from.position.y,
        to.position.y,
        from.velocity?.y,
        to.velocity?.y,
      ),
    ),
    rotation: coordinate(
      from.rotation,
      from.rotation + turn,
      from.spin,
      to.spin,
    ),
  };
};
