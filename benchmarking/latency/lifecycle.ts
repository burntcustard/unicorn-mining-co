type Signal = 'SIGINT' | 'SIGTERM';

/*
 * Signals must finish the same cleanup as normal completion. Keep a final
 * deadline because a disconnected automation endpoint can stop responding.
 */
export function installLatencyShutdown({
  cleanup,
  onInterrupt,
  timeoutMs = 10000,
  signals = process,
  exit = (code) => process.exit(code),
}: {
  cleanup: () => Promise<void>;
  onInterrupt: (signal: Signal) => void;
  timeoutMs?: number;
  signals?: {
    on: (signal: Signal, listener: () => void) => unknown;
    off: (signal: Signal, listener: () => void) => unknown;
  };
  exit?: (code: number) => void;
}) {
  const controller = new AbortController();
  let closing: Promise<void>;
  const close = () => (closing ??= Promise.resolve().then(cleanup));

  const interrupt = (signal: Signal) => {
    if (controller.signal.aborted) return;
    controller.abort(Error(`Latency capture interrupted by ${signal}`));
    onInterrupt(signal);
    const code = signal === 'SIGINT' ? 130 : 143;
    let exited = false;

    const deadline = setTimeout(() => {
      exited = true;
      exit(code);
    }, timeoutMs);

    void close()
      .catch((error) => console.error(error))
      .finally(() => {
        clearTimeout(deadline);

        if (!exited) exit(code);
      });
  };

  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');

  signals.on('SIGINT', onSigint);
  signals.on('SIGTERM', onSigterm);

  return {
    signal: controller.signal,
    close,
    dispose: () => {
      signals.off('SIGINT', onSigint);
      signals.off('SIGTERM', onSigterm);
    },
  };
}
