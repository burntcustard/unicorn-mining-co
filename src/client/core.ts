declare global {
  const canvas: HTMLCanvasElement;
}

/* global canvas */

/**
 * Based on Kontra core.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/core.js
 */

// The canvas element's id is exposed as a global via id-based global binding.

export let context: CanvasRenderingContext2D;

export const init = () => {
  context = canvas.getContext('2d');

  return { canvas, context };
};

export const getContext = () => context;
