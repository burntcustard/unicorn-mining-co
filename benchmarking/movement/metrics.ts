import assert from 'node:assert/strict';

type SpeedSample = { seconds: number; speed: number };

/*
 * Interpolate the time at which the ship crosses a speed between snapshots.
 */
function timeAtSpeed(samples: SpeedSample[], speed: number) {
  const rising = samples[0].speed < speed;
  const index = samples.findIndex((sample) =>
    rising ? sample.speed >= speed : sample.speed <= speed,
  );

  assert(index > 0, `Flight did not cross ${speed} m/s`);
  const before = samples[index - 1];
  const after = samples[index];

  return (
    before.seconds +
    ((speed - before.speed) / (after.speed - before.speed)) *
      (after.seconds - before.seconds)
  );
}

/*
 * Use the same speed intervals for each fit so timing differences within
 * the keyboard edge tick have little effect on the measured slopes.
 */
export function measureLinearMovement({
  thrust,
  coast,
}: {
  thrust: SpeedSample[];
  coast: SpeedSample[];
}) {
  const topSpeed = Math.max(...thrust.map(({ speed }) => speed));
  const releaseSpeed = coast[0].speed;

  return {
    acceleration:
      (0.2 * topSpeed) /
      (timeAtSpeed(thrust, 0.3 * topSpeed) -
        timeAtSpeed(thrust, 0.1 * topSpeed)),
    topSpeed,
    coastDeceleration:
      (0.2 * releaseSpeed) /
      (timeAtSpeed(coast, 0.7 * releaseSpeed) -
        timeAtSpeed(coast, 0.9 * releaseSpeed)),
    coastHalfTime: timeAtSpeed(coast, 0.5 * releaseSpeed),
  };
}
