import { renderBackground } from './background';
import { restoreGraphics } from '../ui/dom/graphics';

window.addEventListener('ui-graphics', restoreGraphics);

// The production IIFE exposes this through its `background` global. Set the
// same bridge in development, where Vite serves this file as an ES module.
Object.assign(globalThis, { background: { renderBackground } });

const skyCanvas =
  document.querySelector<HTMLCanvasElement>('#background-canvas')!;
const ctx = skyCanvas.getContext('2d');
const scale = Math.min(innerWidth, innerHeight) / (720 * 1.5);

skyCanvas.width = canvas.width = innerWidth;
skyCanvas.height = canvas.height = innerHeight;
renderBackground(skyCanvas, ctx, scale);

requestAnimationFrame(() => {
  skyCanvas.style.opacity = canvas.style.opacity = '';
});

export { renderBackground };
