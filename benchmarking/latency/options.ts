import assert from 'node:assert/strict';

export const latencyFireHoldMs = 80;

/*
 * Use one ordinary ammunition item. This is a nominal shot budget, since
 * delayed key releases can lengthen a burst; actual exhaustion ends the case.
 */
export const latencyAmmoPlan = ({
  trials,
  fireInterval,
  roundsPerItem,
}: {
  trials: number;
  fireInterval: number;
  roundsPerItem: number;
}) => {
  const nominalShotsPerTrial = Math.ceil(latencyFireHoldMs / fireInterval);
  const nominalRounds = trials * nominalShotsPerTrial;

  return {
    items: 1,
    rounds: roundsPerItem,
    holdMs: latencyFireHoldMs,
    fireInterval,
    nominalShotsPerTrial,
    nominalRounds,
    nominalSpareRounds: roundsPerItem - nominalRounds,
  };
};

export function parseLatencyOptions(args: string[]) {
  const options = {
    url: 'http://localhost:3000/',
    browser: 'chrome',
    scenario: 'both',
    trials: 100,
    output: '',
    help: false,
    width: 960,
    height: 540,
    maxClockUncertainty: 2,
    minFps: 50,
    preparationTimeoutMs: 600000,
    trialReadinessMs: 8000,
  };

  for (let index = 0; index < args.length; index++) {
    const flag = args[index];

    if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else {
      assert(
        [
          '--url',
          '--browser',
          '--scenario',
          '--trials',
          '--output',
          '--resolution',
        ].includes(flag),
        `Unknown latency option: ${flag}`,
      );
      const value = args[++index];

      assert(value && !value.startsWith('--'), `Missing value for ${flag}`);

      if (flag === '--resolution') {
        assert(/^\d+x\d+$/.test(value), 'Use --resolution WIDTHxHEIGHT');
        [options.width, options.height] = value.split('x').map(Number);
      } else if (flag === '--trials') {
        options.trials = Number(value);
      } else {
        Reflect.set(options, flag.slice(2), value);
      }
    }
  }

  const url = new URL(options.url);

  assert(['http:', 'https:'].includes(url.protocol), 'Use an HTTP(S) game URL');
  assert(
    ['chrome', 'firefox'].includes(options.browser),
    'Choose chrome or firefox',
  );
  assert(
    ['steer', 'fire', 'both'].includes(options.scenario),
    'Choose steer, fire, or both',
  );
  assert(
    Number.isInteger(options.trials) &&
      options.trials >= 1 &&
      options.trials <= 1000,
    'Use 1–1000 trials per scenario',
  );
  assert(
    options.width >= 320 && options.height >= 240,
    'Choose a usable browser resolution',
  );
  options.url = url.href;
  options.output ||= `benchmarking/_local/latency-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
  return options;
}
