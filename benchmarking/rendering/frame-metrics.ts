/**
 * Estimate the display period from idle rAF samples, averaging timestamp
 * quantization over blocks while rejecting occasional dropped refreshes.
 */
export function calibrateRefreshRate({ intervals }: { intervals: number[] }) {
  const samples = intervals.filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (samples.length < 48) {
    throw new Error('Refresh calibration needs at least 48 idle frames');
  }

  const periods = [];

  for (let index = 0; index + 24 <= samples.length; index += 24) {
    periods.push(
      samples.slice(index, index + 24).reduce((sum, value) => sum + value, 0) /
        24,
    );
  }

  periods.sort((left, right) => left - right);
  const period = periods[Math.floor(periods.length / 2)];
  const measuredRate = 1000 / period;

  if (!Number.isFinite(measuredRate) || measuredRate <= 0) {
    throw new Error(
      `Unexpected idle refresh rate: ${measuredRate.toFixed(2)} Hz`,
    );
  }

  return {
    measuredRate,
    refreshRate: measuredRate,
    samples: samples.length,
    source: 'idle-raf',
  };
}

/**
 * Count refresh opportunities missed, rather than treating a healthy 60 Hz
 * frame as a missed 120 Hz frame. Self-contained for the browser fixture.
 */
export function summarizeFrameIntervals({
  intervals,
  refreshRate,
}: {
  intervals: number[];
  refreshRate: number;
}) {
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) {
    throw new Error('Invalid display refresh rate');
  }

  if (
    !intervals.length ||
    intervals.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error('Frame intervals must be positive and finite');
  }

  const sorted = intervals.toSorted((left, right) => left - right);
  const framePeriod = 1000 / refreshRate;
  const missed = intervals.reduce(
    (sum, value) => sum + Math.max(0, Math.round(value / framePeriod) - 1),
    0,
  );

  return {
    fps:
      (intervals.length * 1000) /
      intervals.reduce((sum, value) => sum + value, 0),
    frames: intervals.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    max: sorted.at(-1),
    missed,
    lateFrames: intervals.filter((value) => value >= framePeriod * 1.5).length,
    refreshRate,
    framePeriod,
  };
}
