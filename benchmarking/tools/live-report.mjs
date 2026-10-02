// Regenerate comparable tables from a retained live capture, without players.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [input, destination] = process.argv.slice(2);
const output = destination || 'benchmarking/live/results.md';

assert(
  input,
  'Usage: node benchmarking/tools/live-report.mjs INPUT.json.gz[,REPEAT.json.gz] [OUTPUT.md]',
);
const inputs = input.split(',');
const runs = [];

for (const path of inputs) {
  runs.push(JSON.parse(gunzipSync(await readFile(path))));
}

const selected = new Map();

for (const [index, capture] of runs.entries()) {
  for (const result of capture.results) {
    selected.set(`${result.players}/${result.workload}`, {
      ...result,
      sourceRun: index + 1,
    });
  }

  for (const field of [
    'url',
    'browser',
    'seconds',
    'warmup',
    'cooldown',
    'cooldownBetweenCounts',
  ]) {
    assert.equal(
      capture[field],
      runs[0][field],
      `Repeat must use matching ${field}`,
    );
  }
  assert.deepEqual(
    capture.viewport,
    runs[0].viewport,
    'Combined captures must use matching viewports',
  );
  assert.equal(
    capture.entryAsset.sha256,
    runs[0].entryAsset.sha256,
    'Repeats must use the same deployed release',
  );
}
const run = {
  ...runs[0],
  results: [...selected.values()],
  completedAt: runs.at(-1).completedAt,
};
const quantile = (values, fraction = 0.5) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);

  if (fraction === 0.5) {
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};
const number = (value, digits = 1) => {
  assert(
    Number.isFinite(value),
    'Capture lacks a required network measurement',
  );
  return value.toFixed(digits);
};
const range = (values, digits = 1) => {
  const minimum = number(Math.min(...values), digits);
  const maximum = number(Math.max(...values), digits);

  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
};
const rows = run.counts
  .filter((players) => run.results.some((result) => result.players === players))
  .map((players) => {
    const cases = run.results.filter((result) => result.players === players);
    const gaps = cases.map((result) =>
      quantile(
        result.transports.flatMap((packets) =>
          packets
            .slice(1)
            .map((packet, index) => packet.at - packets[index].at),
        ),
        0.95,
      ),
    );
    const acknowledgements = cases.map((result) =>
      quantile(
        result.captures.flatMap((capture) =>
          capture.acknowledgements.map((ack) => ack.ms),
        ),
        0.95,
      ),
    );

    return [
      players,
      range(
        cases.map((result) =>
          quantile(result.summaries.map((sample) => sample.serverTickHz)),
        ),
        2,
      ),
      number(Math.max(...gaps)),
      number(Math.max(...acknowledgements)),
      range(
        cases.map((result) =>
          quantile(result.summaries.map((sample) => sample.downloadKiBs)),
        ),
      ),
    ];
  });

assert(rows.length, 'Capture has no measured cases');

const measuredAt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  dateStyle: 'long',
  timeStyle: 'long',
}).format(new Date(run.date));
const heading = `## ${measuredAt}`;
const table = [
  '| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((row) => '| ' + row.join(' | ') + ' |'),
].join('\n');
const text = `${heading}

${table}

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

${run.results.some((result) => result.hostCpuBusyPercent >= 90) ? 'Local saturation affected this run’s network timings. ' : ''}These are observed service/network measurements, not server CPU measurements.
${run.failure || !run.completedAt ? '\nIncomplete run: ' + run.results.length + ' of ' + run.counts.length * run.workloads.length + ' cases saved.\n' : ''}`;

await mkdir(dirname(output), { recursive: true });

if (destination) {
  await writeFile(output, '# Live benchmark results\n\n' + text);
} else {
  let previous = '';

  try {
    previous = await readFile(output, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assert(!previous.includes(heading), 'This capture has already been reported');

  if (!previous.includes('\n## ')) {
    previous = '# Live benchmark results\n';
  }
  await writeFile(output, previous.trimEnd() + '\n\n' + text);
}
console.log(output);
