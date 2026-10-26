import {
  muzzleOnset,
  projectileOnset,
  steeringOnset,
  type ResponseFrame,
} from './input-response-metrics.ts';

export type ClockSample = { before: number; after: number; page: number };

export type ClockCalibration = {
  page: number;
  node: number;
  offset: number;
  uncertainty: number;
  timerResolution: number;
  roundTrip: number;
  samples: ClockSample[];
};

/*
 * The minimum round trip bounds an unknown asymmetric transport delay. Keep
 * every sample and both endpoint calibrations instead of assuming browser
 * timeOrigin values share a clock with one another or with Node.
 */
export function calibrateClock(
  samples: ClockSample[],
  timerResolution = 0,
): ClockCalibration {
  if (!samples.length) throw Error('Missing browser clock calibration');
  const best = samples.toSorted(
    (a, b) => a.after - a.before - (b.after - b.before),
  )[0];
  const roundTrip = best.after - best.before;

  if (roundTrip < 0 || !Number.isFinite(roundTrip)) {
    throw Error('Invalid browser clock calibration');
  }

  const node = (best.before + best.after) / 2;

  return {
    page: best.page,
    node,
    offset: node - best.page,
    uncertainty: roundTrip / 2 + timerResolution,
    timerResolution,
    roundTrip,
    samples,
  };
}

export const clockMapping = (
  before: ClockCalibration,
  after: ClockCalibration,
) => {
  const drift = after.offset - before.offset;
  const map = (at: number) =>
    at +
    before.offset +
    drift *
      Math.max(
        0,
        Math.min(1, (at - before.page) / (after.page - before.page || 1)),
      );

  return {
    map,
    uncertainty:
      Math.max(before.uncertainty, after.uncertainty) + Math.abs(drift),
    drift,
  };
};

export function latencyDistribution(values: (number | null)[]) {
  const observed = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );

  return {
    trials: values.length,
    observed: observed.length,
    missed: values.length - observed.length,
    mean: observed.length
      ? observed.reduce((sum, value) => sum + value, 0) / observed.length
      : null,
    min: observed.length ? Math.min(...observed) : null,
    max: observed.length ? Math.max(...observed) : null,
  };
}

/*
 * A trial is one independent actor event. Its three remote observations stay
 * paired; a missing observer makes that trial's average missing as well.
 */
export const observerAverage = (values: (number | null)[]) =>
  values.length === 3 && values.every((value) => value !== null)
    ? (values as number[]).reduce((sum, value) => sum + value, 0) / 3
    : null;

export function responseForTrial({
  frames,
  edgeAt,
  endAt,
  trial,
  previousIds,
}: {
  frames: ResponseFrame[];
  edgeAt: number;
  endAt: number;
  trial: { id: number; kind: string; direction: number };
  previousIds: number[];
}) {
  return trial.kind === 'steer'
    ? {
        steering: steeringOnset({
          frames,
          edgeAt,
          endAt,
          direction: trial.direction,
        }),
      }
    : {
        projectile: projectileOnset({ frames, edgeAt, endAt, previousIds }),
        muzzle: muzzleOnset({ frames, edgeAt, endAt, trialId: trial.id }),
      };
}
