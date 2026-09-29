/* global canvas */

import { context } from './core';
import { maxPredictionTicks, simulationStep } from '../shared/settings';

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

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    // Catch up ordinary missed frames; a longer outage recovers from snapshots.
    const dt = Math.min(
      (now - last) / 1000,
      maxPredictionTicks * simulationStep,
    );

    last = now;

    update({ dt, now });
    context.clearRect(0, 0, canvas.width, canvas.height);
    // A network tick can take much longer than an in-between frame. Predict
    // the displayed pose from the latest clock, after that work is finished.
    render({ dt, now: performance.now() });
  };

  return {
    start() {
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
};
