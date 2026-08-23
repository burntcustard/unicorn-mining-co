/* global z */

/**
 * Based on Kontra core.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/core.js
 */

// The canvas element's id (exposed as a global via id-based global binding)
// must avoid letters roadroller's allowFreeVars reuses as bare globals
// (M,c,h,a,r,C,o,d,e,A,t,U,i,n,y,x,p,f) - 'z' is safely outside that set.

export let context;

export const init = () => {
  context = z.getContext('2d');

  return { canvas: z, context };
};

export const getContext = () => context;
