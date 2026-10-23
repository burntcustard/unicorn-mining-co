export const distribution = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const quantile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;

  return {
    count: sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    max: sorted.at(-1) ?? null,
  };
};

export type SnapshotTrafficMessage = {
  at: number;
  type: string;
  sequence?: number;
  snapshotSequence?: number;
  acknowledgedSequence?: number;
  serverTick?: number;
};

/*
 * Summarize application traffic without treating socket callbacks as wire times.
 * Inputs sent inside the window may complete in the retained observation tail.
 */
export const summarizeSnapshotTraffic = ({
  messages,
  start,
  end,
}: {
  messages: SnapshotTrafficMessage[];
  start: number;
  end: number;
}) => {
  const inside = (message: SnapshotTrafficMessage) =>
    message.at >= start && message.at < end;
  const snapshots = messages.filter(
    (message) => message.type === 'snapshot' || message.type === 'load',
  );
  const received = snapshots.filter(inside);
  const receipts = messages.filter(
    (message) => message.type === 'snapshotAck' && inside(message),
  );
  const inputs = messages.filter(
    (message) => message.type === 'input' && inside(message),
  );
  const acknowledgments = inputs.map((input) =>
    snapshots.find(
      (snapshot) =>
        snapshot.at >= input.at &&
        snapshot.acknowledgedSequence !== undefined &&
        snapshot.acknowledgedSequence >= input.sequence,
    ),
  );
  const durationMs = end - start;
  const rate = (count: number) =>
    durationMs > 0 ? (count * 1000) / durationMs : null;
  const gaps = snapshots.flatMap((message, index) =>
    inside(message) && index > 0 ? [message.at - snapshots[index - 1].at] : [],
  );
  const previous = snapshots.findLast((message) => message.at < end);
  const silenceBoundaries = [
    start,
    ...received.map((message) => message.at),
    end,
  ];
  const silence = silenceBoundaries
    .slice(1)
    .map((at, index) => at - silenceBoundaries[index]);

  return {
    start,
    end,
    durationMs,
    snapshots: received.length,
    snapshotsPerSecond: rate(received.length),
    requestedSnapshots: received.filter(
      (message) => message.snapshotSequence !== undefined,
    ).length,
    receipts: receipts.length,
    receiptsPerSecond: rate(receipts.length),
    snapshotGapMs: distribution(gaps),
    longestSnapshotGapMs: gaps.length ? Math.max(...gaps) : null,
    longestSnapshotSilenceMs: Math.max(0, ...silence),
    snapshotSilenceAtEndMs: previous ? end - previous.at : durationMs,
    receiptGapMs: distribution(
      receipts
        .slice(1)
        .map((message, index) => message.at - receipts[index].at),
    ),
    inputs: inputs.length,
    acknowledgedInputs: acknowledgments.filter(Boolean).length,
    missingInputAcknowledgments: acknowledgments.filter((message) => !message)
      .length,
    inputsPendingAtEnd: acknowledgments.filter(
      (message) => !message || message.at >= end,
    ).length,
    inputAcknowledgmentMs: distribution(
      acknowledgments.flatMap((message, index) =>
        message ? [message.at - inputs[index].at] : [],
      ),
    ),
    measurement:
      'Application input send to decoded snapshot receive; snapshotAck counts are application sends, not server receipt or wire times. Snapshot gaps end inside the window and may start before it; longest snapshot silence includes window boundaries. Missing acknowledgments remain explicit; observed acknowledgments may complete after the window in the retained tail.',
  };
};
