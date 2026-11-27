/**
 * Collect browser-observed traffic and reconciliation timings without decoding
 * packets again. This function is embedded in the benchmark fixture.
 */
export function createNetworkObservations(captureStartedAt: number) {
  const messageSizes: number[] = [];
  const messageGaps: number[] = [];
  const reconcileTimes: number[] = [];
  const localPositionErrors: number[] = [];
  const replaySamples: number[][] = [];
  let previousMessageAt: number | undefined;
  let encoder: TextEncoder | undefined;

  const distribution = (values: number[]) => {
    const sorted = values.toSorted((a, b) => a - b);

    return Object.fromEntries([
      ['samples', sorted.length],
      ['p95', sorted[Math.floor(sorted.length * 0.95)] ?? null],
      ['max', sorted.at(-1) ?? null],
    ]);
  };

  return {
    recordMessage({ data, startedAt }: { data: unknown; startedAt: number }) {
      if (previousMessageAt !== undefined) {
        messageGaps.push(startedAt - previousMessageAt);
      }

      previousMessageAt = startedAt;

      if (typeof data === 'string') {
        encoder ??= new TextEncoder();
        messageSizes.push(encoder.encode(data).byteLength);
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        messageSizes.push(data.byteLength);
      } else if (data instanceof Blob) {
        messageSizes.push(data.size);
      }
    },
    recordReconcile({
      duration,
      localPositionError,
    }: {
      duration: number;
      localPositionError?: number;
    }) {
      reconcileTimes.push(duration);

      if (localPositionError !== undefined) {
        localPositionErrors.push(localPositionError);
      }
    },
    recordReplay({
      startedAt,
      duration,
      fromTick,
      targetTick,
    }: {
      startedAt: number;
      duration: number;
      fromTick: number;
      targetTick: number;
    }) {
      replaySamples.push([
        startedAt - captureStartedAt,
        duration,
        fromTick,
        targetTick,
      ]);
    },
    summary(firstFrameAt: number) {
      return Object.fromEntries([
        ['first-raf-capture-offset-ms', firstFrameAt - captureStartedAt],
        ['websocket-payload-bytes', distribution(messageSizes)],
        [
          'websocket-total-payload-bytes',
          messageSizes.reduce((a, b) => a + b, 0),
        ],
        ['websocket-message-gap-ms', distribution(messageGaps)],
        ['reconcile-ms', distribution(reconcileTimes)],
        ['local-same-tick-position-error-m', distribution(localPositionErrors)],
        [
          'full-replay-columns',
          ['capture-time-ms', 'duration-ms', 'from-tick', 'target-tick'],
        ],
        ['full-replay-samples', replaySamples],
      ]);
    },
  };
}
