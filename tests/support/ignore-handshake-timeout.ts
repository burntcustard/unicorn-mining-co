// These simulation fixtures inject messages directly rather than completing a
// WebSocket handshake. Do not leave their unused handshake timers running.
const originalSetTimeout = globalThis.setTimeout;

Object.assign(globalThis, {
  setTimeout: (
    callback: (...args: never[]) => void,
    delay?: number,
    ...args: never[]
  ) => {
    if (delay === 15000) {
      const timer = originalSetTimeout(() => {}, delay);

      timer.unref();
      return timer;
    }

    return originalSetTimeout(callback, delay, ...args);
  },
});
