/* global canvas */

import { context } from './core';

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
    // Discard frame debt after a stall; networking restores the server clock.
    const dt = Math.min((now - last) / 1000, 1 / 15);

    last = now;

    // Updating a network tick is heavier than an in-between frame. Both phases
    // must sample the same instant, not turn that extra CPU time into movement.
    const timing = { dt, now };
    update(timing);
    context.clearRect(0, 0, canvas.width, canvas.height);
    render(timing);
  };

  return {
    start() {
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
};
