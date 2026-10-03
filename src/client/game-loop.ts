/* global canvas */

import { context } from './core';
import { maxPredictionTicks } from '../definitions/prediction';
import { simulationStep } from '../definitions/simulation';

/**
 * Based on Kontra gameLoop.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/gameLoop.js
 */
export const GameLoop = ({
  render,
  update,
}: {
  render: (frame: { dt: number; now: number }) => void;
  update: (frame: { dt: number; now: number }) => void;
}) => {
  let last = 0;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    // Catch up ordinary missed frames; a longer outage recovers from snapshots.
    const dt = Math.min(
      Math.max(0, (now - last) / 1000),
      maxPredictionTicks * simulationStep,
    );

    last = now;

    update({ dt, now });
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Use the display timestamp for both phases. Sampling CPU completion time
    // turns variable tick/reconciliation cost into visible speed changes.
    render({ dt, now });
  };

  return {
    start() {
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
};
