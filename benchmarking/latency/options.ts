import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

export const latencyFireHoldMs = 80;

export function parseLatencyOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: 'string', default: 'local' },
      scenario: { type: 'string', default: 'both' },
      trials: { type: 'string', default: '5' },
      resolution: { type: 'string', default: '960x540' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const { target, scenario, resolution } = values;
  const trials = Number(values.trials);

  assert(['local', 'live'].includes(target), 'Choose local or live');
  assert(
    ['steer', 'fire', 'both'].includes(scenario),
    'Choose steer, fire, or both',
  );
  assert(
    Number.isInteger(trials) && trials >= 1 && trials <= 1000,
    'Use 1–1000 trials per scenario',
  );
  assert(/^\d+x\d+$/.test(resolution), 'Use --resolution WIDTHxHEIGHT');
  const [width, height] = resolution.split('x').map(Number);

  assert(width >= 320 && height >= 240, 'Choose a usable browser resolution');

  return {
    target,
    url:
      target === 'local'
        ? 'http://localhost:3000/'
        : 'https://unicorn-mining.co/',
    scenario,
    trials,
    width,
    height,
    output:
      values.output ||
      `benchmarking/_local/latency-${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`,
    help: values.help,
    maxClockUncertainty: 2,
    minFps: 50,
    preparationTimeoutMs: 600000,
    trialReadinessMs: 8000,
  };
}
