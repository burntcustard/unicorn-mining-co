import { renderBackground } from './background';
import { graphics, restoreGraphics } from '../ui/dom/graphics';

window.addEventListener('ui-graphics', restoreGraphics);

// The production IIFE exposes this through its `background` global. Set the
// same bridge in development, where Vite serves this file as an ES module.
Object.assign(globalThis, { background: { renderBackground } });

const skyCanvas =
  document.querySelector<HTMLCanvasElement>('#background-canvas')!;
const ctx = skyCanvas.getContext('2d');
const resolution = graphics[3] * (devicePixelRatio || 1);
const scale = (Math.min(innerWidth, innerHeight) / (720 * 1.5)) * resolution;

skyCanvas.width = canvas.width = innerWidth * resolution;
skyCanvas.height = canvas.height = innerHeight * resolution;
renderBackground(skyCanvas, ctx, scale);

requestAnimationFrame(() => {
  skyCanvas.style.opacity = canvas.style.opacity = '';
});

export { renderBackground };
