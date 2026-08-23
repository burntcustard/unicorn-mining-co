/* global c */

/**
 * Based on Kontra core.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/core.js
 */

export let context;

export const init = () => {
  context = c.getContext('2d');

  return { canvas: c, context };
};

export const getContext = () => context;
