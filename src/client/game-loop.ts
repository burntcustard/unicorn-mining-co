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
  render: () => void;
  update: (step: number) => void;
}) => {
  let last = 0;
  let accumulator = 0;
  const delta = 1000 / 60;
  const step = 1 / 60;

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const elapsed = now - last;

    last = now;

    // Drop excessive frame debt. Networking restores the authoritative clock;
    // simulating every missed frame here would create another stall.
    for (
      accumulator = Math.min(accumulator + elapsed, delta * 4);
      accumulator >= delta;
      accumulator -= delta
    )
      update(step);
    context.clearRect(0, 0, canvas.width, canvas.height);
    render();
  };

  return {
    start() {
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
};
