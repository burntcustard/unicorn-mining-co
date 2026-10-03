import { setImmediate } from 'node:timers/promises';
import { mock } from 'node:test';

// Advance the same timers used by the server and clients while allowing real
// WebSocket I/O to finish between milliseconds of simulated time.
export const createTestClock = () => {
  let now = 0;
  const performanceNow = mock.method(performance, 'now', () => now);

  mock.timers.enable({
    apis: ['Date', 'setTimeout', 'setInterval'],
    now: Date.now(),
  });
  return {
    async advance({ milliseconds }: { milliseconds: number }) {
      const end = now + milliseconds;

      while (now < end) {
        const elapsed = Math.min(1, end - now);

        now += elapsed;
        mock.timers.tick(elapsed);
        // Writes and their receipts each need an event-loop turn.
        await setImmediate();
        await setImmediate();
      }
    },
    restore() {
      mock.timers.reset();
      performanceNow.mock.restore();
    },
  };
};
