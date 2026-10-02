import assert from 'node:assert/strict';
import { replayTrajectory } from '../benchmarking/remote-trajectory-workload';
import { interpolatePose } from '../src/shared/utilities/interpolate-pose';
import { simulationStep } from '../src/shared/settings';
import * as Vec from '../src/shared/vector';

for (const fps of [30, 60, 144]) {
  for (const acceleration of [40, 120]) {
    for (const turn of [0, 0.4]) {
      const result = replayTrajectory([fps, acceleration, turn]);

      assert(result.maxPositionError < 1e-8, JSON.stringify(result));
      assert(result.maxRotationError < 1e-8, JSON.stringify(result));
      assert(result.maxAdvanceError < 1e-8, JSON.stringify(result));
    }
  }
}

// Reversals and stops must remain within known endpoints, even when the
// velocities would otherwise cause a cubic to pass through a collision hull.
for (const direction of [-1, 1]) {
  let previous = -Infinity;

  for (let frame = 0; frame <= 100; frame++) {
    const position =
      interpolatePose({
        from: {
          position: Vec.create(),
          rotation: 0,
          velocity: Vec.create(1000 * direction),
        },
        to: {
          position: Vec.create(4 * direction),
          rotation: 0,
          velocity: Vec.create(-1000 * direction),
        },
        fraction: frame / 100,
        dt: simulationStep,
      }).position.x * direction;

    assert(position >= -1e-9 && position <= 4 + 1e-9);
    assert(
      position >= previous - 1e-9,
      'known forward segment must not move backwards',
    );
    previous = position;
  }
}
console.log(
  'Accelerating remote flight follows its analytic path; collision reversals never overshoot',
);
