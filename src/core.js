/* global z */

/**
 * Based on Kontra core.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/core.js
 */

// The canvas element's id is exposed as a global via id-based global binding.

export let context;

export const init = () => {
  context = z.getContext('2d');

  return { canvas: z, context };
};

export const getContext = () => context;
