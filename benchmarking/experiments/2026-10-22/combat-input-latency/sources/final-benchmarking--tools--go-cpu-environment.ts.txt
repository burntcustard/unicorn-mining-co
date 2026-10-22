import { readFileSync } from 'node:fs';

function defaultAffinity() {
  const allowed = readFileSync('/proc/self/status', 'utf8')
    .match(/Cpus_allowed_list:\s*([\d,-]+)/)[1]
    .split(',')
    .flatMap((range) => {
      const [first, last = first] = range.split('-').map(Number);

      return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    });

  const cores = new Set<string>();
  const selected: number[] = [];

  for (const cpu of allowed) {
    const topology = `/sys/devices/system/cpu/cpu${cpu}/topology`;
    const core = `${readFileSync(`${topology}/physical_package_id`, 'utf8').trim()}/${readFileSync(`${topology}/core_id`, 'utf8').trim()}`;

    if (cores.has(core)) continue;
    cores.add(core);
    selected.push(cpu);

    if (selected.length === 2) break;
  }

  return selected.join(',');
}

export const cpuAffinity =
  process.env.CPU_AFFINITY || process.env.CPUSET || defaultAffinity();

export const goEnvironment = {
  ...process.env,
  GOGC: process.env.GOGC || '200',
  GOMAXPROCS: process.env.GOMAXPROCS || '2',
};
