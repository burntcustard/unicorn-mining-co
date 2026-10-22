import type { LiveResult } from './live.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const [inputs, output] = process.argv.slice(2);

assert(
  inputs && output,
  'Usage: node benchmarking/tools/live-ack-analysis.ts INPUT.json.gz[,INPUT.json.gz] OUTPUT.json.gz',
);

const distribution = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  const middle = Math.floor(sorted.length / 2);

  return {
    count: sorted.length,
    mean: sorted.length
      ? sorted.reduce((total, value) => total + value, 0) / sorted.length
      : null,
    p50: sorted.length
      ? sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
      : null,
    p95: quantile(0.95),
    max: sorted.at(-1) ?? null,
  };
};

const histogram = (values: number[]) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort((a, b) => a - b)
      .map((value) => [
        value,
        values.filter((other) => other === value).length,
      ]),
  );

const lowerBound = (values: number[], target: number) => {
  let lower = 0,
    upper = values.length;

  while (lower < upper) {
    const middle = (lower + upper) >>> 1;

    if (values[middle] < target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return lower;
};

const analyzeCase = (result: LiveResult) => {
  const tickDurationMs = 1000 / 30;
  const tickClockOffset = Math.min(
    ...result.transports.flatMap((packets) =>
      packets.map((packet) => packet.at - packet.tick * tickDurationMs),
    ),
  );

  const clients = result.captures.map((capture, index) => {
    const transports = new Map(
      result.transports[index].map((packet) => [packet.tick, packet.at]),
    );
    const matched = capture.snapshots.filter((snapshot) =>
      transports.has(snapshot.tick),
    );

    // Both clocks are monotonic. The largest offset removes the least-delayed
    // matched callback, leaving relative dispatch delay rather than wire delay.
    const clockOffset = Math.max(
      ...matched.map(
        (snapshot) => transports.get(snapshot.tick)! - snapshot.at,
      ),
    );
    const dispatch = matched.map(
      (snapshot) => snapshot.at + clockOffset - transports.get(snapshot.tick)!,
    );
    const times = capture.snapshots.map((snapshot) => snapshot.at);
    const inputs = new Map(
      capture.inputs.map((input) => [input.sequence, input]),
    );

    const acknowledgments = capture.acknowledgments.map((ack) => {
      const input = inputs.get(ack.sequence);

      assert(input, 'Every measured acknowledgment needs its input');
      const receivedAt = input.at + ack.ms;
      const receivedIndex = lowerBound(times, receivedAt - 0.00001);
      const sentIndex = lowerBound(times, input.at + 0.00001);
      const snapshot = capture.snapshots[receivedIndex];

      assert(snapshot, 'Every acknowledgment must match a received snapshot');
      assert(Math.abs(snapshot.at - receivedAt) < 0.0001);
      const previous = capture.snapshots[sentIndex - 1];
      const generatedAt = snapshot.tick * tickDurationMs + tickClockOffset;

      return {
        ms: ack.ms,
        snapshotsBeforeAck: receivedIndex - sentIndex,
        firstSnapshotDelayMs: times[sentIndex] - input.at,
        acknowledgedTickDelta: snapshot.tick - input.tick,
        relativeSnapshotAgeMs: receivedAt + clockOffset - generatedAt,
        relativeSendToGenerationMs: generatedAt - input.at - clockOffset,
        sendPredictionLeadTicks: previous ? input.tick - previous.tick : null,
      };
    });

    const batches: number[] = [];

    for (const snapshot of capture.snapshots) {
      if (snapshot.gap !== null && snapshot.gap <= 5 && batches.length) {
        batches[batches.length - 1]++;
      } else {
        batches.push(1);
      }
    }

    return {
      client: index + 1,
      fps:
        (capture.frames.length * 1000) /
        capture.frames.reduce((total, value) => total + value, 0),
      durationMs: capture.end - capture.start,
      pendingInputs: capture.pendingInputs,
      sentInputs: capture.inputs.length,
      snapshots: capture.snapshots.length,
      downloadKiBs: result.summaries[index].downloadKiBs,
      entities: distribution(
        capture.ownSamples.map((sample) => sample.entities),
      ),
      frameMs: distribution(capture.frames),
      probeDecodeMs: distribution(capture.decodeCosts),
      dispatchRelativeMs: distribution(dispatch),
      acknowledgmentMs: distribution(acknowledgments.map((ack) => ack.ms)),
      snapshotsBeforeAck: distribution(
        acknowledgments.map((ack) => ack.snapshotsBeforeAck),
      ),
      fastBatches: distribution(batches),
      fastBatchHistogram: histogram(batches),
      acknowledgments,
      frames: capture.frames,
      batches,
      dispatch,
      inputLeads: capture.snapshots.flatMap((snapshot) =>
        snapshot.lead === undefined ? [] : [snapshot.lead],
      ),
    };
  });

  const acknowledgments = clients.flatMap((client) => client.acknowledgments);
  const batches = clients.flatMap((client) => client.batches);
  const manySnapshots = acknowledgments.filter(
    (ack) => ack.snapshotsBeforeAck > 9,
  );
  const futureInputs = acknowledgments.filter(
    (ack) =>
      ack.sendPredictionLeadTicks !== null && ack.sendPredictionLeadTicks > 2,
  );
  const threshold = distribution(acknowledgments.map((ack) => ack.ms)).p95;
  const tail = acknowledgments.filter((ack) => ack.ms >= threshold!);

  return {
    players: result.players,
    workload: result.workload,
    hostCpuBusyPercent: result.hostCpuBusyPercent,
    controllerGapMs: result.controllerGapMs,
    medianClientFps: distribution(clients.map((client) => client.fps)).p50,
    snapshotsPerClient: distribution(clients.map((client) => client.snapshots)),
    downloadKiBsPerClient: distribution(
      clients.map((client) => client.downloadKiBs),
    ),
    frameMs: distribution(clients.flatMap((client) => client.frames)),
    entities: distribution(
      result.captures.flatMap((capture) =>
        capture.ownSamples.map((sample) => sample.entities),
      ),
    ),
    inputLeadTicks: distribution(
      clients.flatMap((client) => client.inputLeads),
    ),
    dispatchRelativeMs: distribution(
      clients.flatMap((client) => client.dispatch),
    ),
    acknowledgmentMs: distribution(acknowledgments.map((ack) => ack.ms)),
    snapshotsBeforeAck: distribution(
      acknowledgments.map((ack) => ack.snapshotsBeforeAck),
    ),
    snapshotsBeforeAckHistogram: histogram(
      acknowledgments.map((ack) => ack.snapshotsBeforeAck),
    ),
    firstSnapshotDelayMs: distribution(
      acknowledgments.map((ack) => ack.firstSnapshotDelayMs),
    ),
    acknowledgedTickDelta: distribution(
      acknowledgments.map((ack) => ack.acknowledgedTickDelta),
    ),
    sendPredictionLeadTicks: distribution(
      acknowledgments.flatMap((ack) =>
        ack.sendPredictionLeadTicks === null
          ? []
          : [ack.sendPredictionLeadTicks],
      ),
    ),
    relativeSnapshotAgeMs: distribution(
      acknowledgments.map((ack) => ack.relativeSnapshotAgeMs),
    ),
    relativeSendToGenerationMs: distribution(
      acknowledgments.map((ack) => ack.relativeSendToGenerationMs),
    ),
    worstFivePercent: {
      relativeSnapshotAgeMs: distribution(
        tail.map((ack) => ack.relativeSnapshotAgeMs),
      ),
      relativeSendToGenerationMs: distribution(
        tail.map((ack) => ack.relativeSendToGenerationMs),
      ),
      snapshotsBeforeAck: distribution(
        tail.map((ack) => ack.snapshotsBeforeAck),
      ),
    },
    fastBatches: distribution(batches),
    fastBatchHistogram: histogram(batches),
    fastBatchesOverNine: batches.filter((count) => count > 9).length,
    acknowledgmentsAfterOverNineSnapshotsMs: distribution(
      manySnapshots.map((ack) => ack.ms),
    ),
    acknowledgmentsForFutureInputsMs: distribution(
      futureInputs.map((ack) => ack.ms),
    ),
    clients: clients.map(
      ({
        acknowledgments: _acknowledgments,
        frames: _frames,
        batches: _batches,
        dispatch: _dispatch,
        inputLeads: _inputLeads,
        ...client
      }) => client,
    ),
  };
};

const runs = [];

for (const path of inputs.split(',')) {
  const bytes = await readFile(path);

  const capture = JSON.parse(gunzipSync(bytes).toString()) as {
    date: string;
    browser: string;
    runnerHash: string;
    results: LiveResult[];
  };

  runs.push({
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    date: capture.date,
    browser: capture.browser,
    runnerHash: capture.runnerHash,
    cases: capture.results.map(analyzeCase),
  });
}

await mkdir(dirname(output), { recursive: true });

await writeFile(
  output,
  gzipSync(
    JSON.stringify(
      {
        method: {
          quantile:
            'Nearest rank p95; arithmetic median p50; pooled input acknowledgments per case.',
          fastBatch:
            'Consecutive JavaScript snapshot receipt gaps at most 5 ms.',
          acknowledgment:
            'Match input sequence, reconstruct receipt at input.at + acknowledgment.ms, then match snapshot timestamp.',
          dispatch:
            'Match snapshots and CDP frames by server tick; subtract per-page maximum CDP timestamp minus JavaScript timestamp.',
          tickAgeModel:
            'Assume 30 ticks/s. The case-wide minimum of CDP receipt timestamp minus tick*1000/30 calibrates a relative tick clock; split acknowledgment delay into relative send-to-generation and snapshot age. Unknown fixed network latency shifts this split, and tick-rate drift limits precision.',
          caveat:
            'CDP timestamps track the same overloaded receipt batches. Relative dispatch residuals do not isolate network or wire arrival latency.',
        },
        runs,
      },
      null,
      2,
    ) + '\n',
  ),
);

console.log(output);
