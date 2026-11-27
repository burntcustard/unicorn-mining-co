import { parseArgs } from 'node:util';

const scenarios = ['live', 'large', 'combat', 'flight', 'pirate'] as const;

export const shipDestructionFlags = {
  'until-ship-destroyed': { type: 'boolean' },
  'until-two-ships-destroyed': { type: 'boolean' },
} as const;

export function parseShipDestructionLimit({
  'until-ship-destroyed': untilFirst,
  'until-two-ships-destroyed': untilSecond,
}: Partial<Record<keyof typeof shipDestructionFlags, boolean>>) {
  if (untilFirst && untilSecond) {
    throw new Error('Choose one ship destruction flag');
  }

  return untilSecond ? 2 : untilFirst ? 1 : 0;
}

export function parseRenderingOptions({ args }: { args: string[] }) {
  const { values } = parseArgs({
    args,
    options: {
      browser: { type: 'string', default: 'chrome' },
      scenario: { type: 'string', default: 'all' },
      seconds: { type: 'string', default: '30' },
      ...shipDestructionFlags,
      'cpu-throttle': { type: 'string', default: '1' },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  const browser = values.browser;
  const seconds = Number(values.seconds);
  const shipDestructionLimit = parseShipDestructionLimit(values);
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

  if (shipDestructionLimit && (chosen.length !== 1 || chosen[0] !== 'pirate')) {
    throw new Error('Use ship destruction flags with --scenario pirate');
  }

  return {
    browser,
    seconds: shipDestructionLimit ? undefined : seconds,
    shipDestructionLimit,
    cpuThrottle,
    output: values.output || `benchmarking/_local/gameplay-${browser}.json`,
    scenarios: [...new Set(chosen)],
    help: values.help,
  };
}
