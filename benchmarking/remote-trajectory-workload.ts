import { interpolatePose } from '../src/shared/utilities/interpolate-pose';
import { simulationStep } from '../src/shared/settings';
import * as Vec from '../src/shared/vector';

// Known accelerating motion isolates interpolation from contacts and network
// corrections. Both linear and angular motion have exact analytic references.
export const replayTrajectory = ([
  fps,
  acceleration,
  angularAcceleration,
]: number[]) => {
  const position = (time: number) =>
    Vec.create(
      80 * time + (acceleration * time * time) / 2,
      40 * time - (acceleration * time * time) / 4,
    );
  const rotation = (time: number) => (angularAcceleration * time * time) / 2;
  let previous: Vec.Value | undefined;
  let previousReference: Vec.Value | undefined;
  let maxPositionError = 0;
  let maxRotationError = 0;
  let maxAdvanceError = 0;

  for (let frame = 0; frame <= 3 * fps; frame++) {
    const now = (frame * 1000) / fps;

    const time = now / 1000;
    const tick = Math.floor(time / simulationStep);
    const endpoint = (time: number) => ({
      position: position(time),
      rotation: rotation(time),
      velocity: Vec.create(
        80 + acceleration * time,
        40 - (acceleration * time) / 2,
      ),
      spin: angularAcceleration * time,
    });
    const pose = interpolatePose({
      from: endpoint(tick * simulationStep),
      to: endpoint((tick + 1) * simulationStep),
      fraction: time / simulationStep - tick,
      dt: simulationStep,
    });
    const reference = position(time);

    if (frame > fps && previous && previousReference) {
      maxPositionError = Math.max(
        maxPositionError,
        Vec.distance(pose.position, reference),
      );
      maxRotationError = Math.max(
        maxRotationError,
        Math.abs(pose.rotation - rotation(time)),
      );
      maxAdvanceError = Math.max(
        maxAdvanceError,
        Vec.distance(
          Vec.subtract(pose.position, previous),
          Vec.subtract(reference, previousReference),
        ),
      );
    }
    previous = pose.position;
    previousReference = reference;
  }
  return {
    fps,
    acceleration,
    angularAcceleration,
    maxPositionError,
    maxRotationError,
    maxAdvanceError,
  };
};
