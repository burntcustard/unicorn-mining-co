import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const path = process.argv[2];
const capture = JSON.parse(gunzipSync(readFileSync(path)).toString());

assert(capture.completedAt, 'Transport capture is incomplete');
assert.equal(
  capture.results.length,
  capture.cases.length * capture.repetitions * 2,
);
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const groups = Map.groupBy(
  capture.results,
  (row: any) => `${row.players}/${row.activity}`,
);
const cases = [];

for (const [name, samples] of groups) {
  const variants = Object.fromEntries(
    ['before', 'after'].map((variant) => {
      const rows = samples.filter((row: any) => row.variant === variant);

      assert.equal(rows.length, capture.repetitions);

      for (const row of rows) {
        assert.equal(row.gomaxprocs, 2);
        assert.equal(row.gogc, '200');
        assert.equal(row.affinity, '0,1');
        assert.equal(row.clients.length, row.players);
      }

      const clients = rows.flatMap((row: any) => row.clients);

      return [
        variant,
        {
          cpuMsPerTick: median(rows.map((row: any) => row.cpuMsPerTick)),
          minimumSnapshotHz: Math.min(
            ...clients.map((client) => client.snapshotHz),
          ),
          minimumInputHz: Math.min(...clients.map((client) => client.inputHz)),
          worstSnapshotGapP95Ms: Math.max(
            ...clients.map((client) => client.snapshotGapP95Ms),
          ),
          worstInputAckP95Ms: Math.max(
            ...clients.map((client) => client.inputAckP95Ms),
          ),
          maxSnapshotGapMs: Math.max(
            ...clients.map((client) => client.maxSnapshotGapMs),
          ),
          maxInputAckMs: Math.max(
            ...clients.map((client) => client.maxInputAckMs),
          ),
          controlMessages: clients.reduce((totals, client) => {
            for (const [kind, count] of Object.entries(
              client.controlMessages,
            )) {
              totals[kind] = (totals[kind] || 0) + count;
            }

            return totals;
          }, {}),
        },
      ];
    }),
  );

  cases.push({
    name,
    before: variants.before,
    after: variants.after,
    cpuSavedPercent:
      100 * (1 - variants.after.cpuMsPerTick / variants.before.cpuMsPerTick),
  });
}

const summary = {
  source: path,
  repetitions: capture.repetitions,
  cases,
  aggregateCpuSavedPercent:
    100 *
    (1 -
      cases.reduce((sum, row) => sum + row.after.cpuMsPerTick, 0) /
        cases.reduce((sum, row) => sum + row.before.cpuMsPerTick, 0)),
};

writeFileSync(
  path.replace(/\.json\.gz$/, '-summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(JSON.stringify(summary, null, 2));
