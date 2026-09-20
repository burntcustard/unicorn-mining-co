import { renderBackground } from './background';

// The production IIFE exposes this through its `background` global. Set the
// same bridge in development, where Vite serves this file as an ES module.
Object.assign(globalThis, { background: { renderBackground } });

const ctx = canvas.getContext('2d');
const scale = innerWidth / (720 * 1.5);

canvas.width = innerWidth;
canvas.height = innerHeight;
renderBackground(canvas, ctx, scale);
requestAnimationFrame(() => canvas.style.opacity = '');

export { renderBackground };
