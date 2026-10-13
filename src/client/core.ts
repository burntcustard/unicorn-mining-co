declare global {
  const canvas: HTMLCanvasElement;
}

import { WorldRenderer } from './utilities/world-renderer';
import { useWebGL } from './ui/dom/graphics';

/* global canvas */

/**
 * Based on Kontra core.js, available under the MIT license:
 * https://github.com/straker/kontra/blob/main/src/core.js
 */

// The canvas element's id is exposed as a global via id-based global binding.

export let context: CanvasRenderingContext2D;
let renderer: WorldRenderer;
let hud: HTMLCanvasElement;

export const hudContext = () => {
  if (!renderer) return context;

  if (!hud) {
    hud = document.createElement('canvas');
    hud.className = 'foreground-hud';
    hud.setAttribute('aria-hidden', 'true');
    canvas.after(hud);
  }

  if (hud.width !== canvas.width || hud.height !== canvas.height) {
    hud.width = canvas.width;
    hud.height = canvas.height;
  }

  return hud.getContext('2d');
};

export const clearFrame = () => {
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (renderer) hudContext().clearRect(0, 0, canvas.width, canvas.height);
};

export const presentFrame = () => renderer?.present();

export const init = () => {
  // Both rendering paths preserve the drawing API and native pixel density.
  if (useWebGL) {
    renderer = WorldRenderer.create(canvas);
  }

  if (renderer) {
    context = renderer as unknown as CanvasRenderingContext2D;
  } else {
    context = canvas.getContext('2d', { willReadFrequently: true });
  }

  return { canvas, context };
};

export const getContext = () => context;
