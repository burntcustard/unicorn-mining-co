import { parseArgs } from 'node:util';

const scenarios = ['live', 'large', 'combat', 'flight', 'pirate'] as const;

export function parseRenderingOptions({ args }: { args: string[] }) {
  const { values } = parseArgs({
    args,
    options: {
      browser: { type: 'string', default: 'chrome' },
      scenario: { type: 'string', default: 'all' },
      seconds: { type: 'string', default: '30' },
      'cpu-throttle': { type: 'string', default: '1' },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  const browser = values.browser;
  const seconds = Number(values.seconds);
  const cpuThrottle = Number(values['cpu-throttle']);
  const selected = values.scenario.split(',');
  const chosen = selected.includes('all') ? [...scenarios] : selected;

  if (!['chrome', 'firefox'].includes(browser)) {
    throw new Error('Choose chrome or firefox');
  }

  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    throw new Error('Capture between 1 and 600 seconds per scenario');
  }

  if (!Number.isFinite(cpuThrottle) || cpuThrottle < 1) {
    throw new Error('CPU throttle must be a finite rate of at least 1');
  }

  if (browser !== 'chrome' && cpuThrottle !== 1) {
    throw new Error('CPU throttling requires Chrome');
  }

  if (
    !chosen.length ||
    chosen.some(
      (name) => !scenarios.includes(name as (typeof scenarios)[number]),
    )
  ) {
    throw new Error(`Choose scenarios: ${scenarios.join(', ')}`);
  }

  return {
    browser,
    seconds,
    cpuThrottle,
    output: values.output || `benchmarking/_local/gameplay-${browser}.json`,
    scenarios: [...new Set(chosen)],
    help: values.help,
  };
}
