import assert from 'node:assert/strict';
import { interpolatePose } from '../../src/client/utilities/interpolate-pose';
import * as Vec from '../../src/client/utilities/vector';
import { simulationStep } from '../../src/specs/simulation';

// Collision reversals and abrupt stops must not carry the displayed craft
// outside the known segment or make it travel backward between its endpoints.
for (const direction of [-1, 1]) {
  for (const endingVelocity of [-1000, 0]) {
    let previous = 0;

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
            velocity: Vec.create(endingVelocity * direction),
          },
          fraction: frame / 100,
          dt: simulationStep,
        }).position.x * direction;

      assert(position >= -1e-9 && position <= 4 + 1e-9);
      assert(
        position >= previous - 1e-9,
        'Interpolation must remain monotonic',
      );

      if (frame === 0) {
        assert(position === 0);
      }

      if (frame === 100) {
        assert.equal(position, 4);
      }

      previous = position;
    }
  }
}
