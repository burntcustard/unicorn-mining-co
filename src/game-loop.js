/* global c */

import { context } from './core';

/**
 * Based on Kontra gameLoop.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/gameLoop.js
 */
export const GameLoop = ({ render, update }) => {
  let last;
  let accumulator = 0;
  const delta = 1000 / 60;
  const step = 1 / 60;

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const elapsed = now - last;

    last = now;

    if (elapsed > 1000) return;

    for (accumulator += elapsed; accumulator >= delta; accumulator -= delta) update(step);
    context.clearRect(0, 0, c.width, c.height);
    render();
  };

  return {
    start() {
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
};
