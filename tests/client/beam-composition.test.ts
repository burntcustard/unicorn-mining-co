/* global Buffer, process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

// Model a partially transparent beam pixel using Canvas source-over and
// lighten equations, including the shared layer's final opacity.
class PixelCanvas {
  width = 100;
  height = 100;
  isConnected = false;
  className = '';
  value = 0;
  alpha = 0;
  paint = new PixelContext(this);

  getContext() {
    return this.paint;
  }

  setAttribute() {}

  before(canvas: PixelCanvas) {
    canvas.isConnected = true;
  }
}

class PixelContext {
  fillStyle: unknown;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  filter = 'none';
  states: { alpha: number; composite: string; filter: string }[] = [];

  constructor(public canvas: PixelCanvas) {}

  resetTransform() {}
  translate() {}
  scale() {}
  setTransform() {}
  clip() {}

  getTransform() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  save() {
    this.states.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      filter: this.filter,
    });
  }

  restore() {
    const state = this.states.pop()!;

    this.globalAlpha = state.alpha;
    this.globalCompositeOperation = state.composite;
    this.filter = state.filter;
  }

  createLinearGradient() {
    return { addColorStop() {} };
  }

  fillRect() {
    this.canvas.value = 0;
    this.canvas.alpha = 1;
  }

  fill() {
    // A mid-beam pixel is half white. Preserve its source alpha over black.
    this.canvas.value = this.canvas.alpha ? 0.5 : 1;
    this.canvas.alpha = this.canvas.alpha ? 1 : 0.5;
  }

  drawImage(source: PixelCanvas) {
    const brightness = this.filter.startsWith('brightness(')
      ? Number(this.filter.slice(11, -1))
      : 1;
    const alpha = source.alpha * this.globalAlpha;
    const value = source.value * brightness;

    const blended =
      this.globalCompositeOperation === 'lighten'
        ? Math.max(this.canvas.value, value)
        : this.globalCompositeOperation === 'screen'
          ? 1 - (1 - this.canvas.value) * (1 - value)
          : value;

    this.canvas.value = (1 - alpha) * this.canvas.value + alpha * blended;
    this.canvas.alpha = 1;
  }
}

const created: PixelCanvas[] = [];

Object.assign(globalThis, {
  Path2D: class {},
  document: {
    createElement: () => {
      const canvas = new PixelCanvas();

      created.push(canvas);
      return canvas;
    },
  },
  createImageBitmap: () => new Promise(() => {}),
});

const entry = `${process.cwd()}/src/__beam_composition_test.ts`;

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'beam-composition-test',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? "export { game } from './client/game'; export { beginBeams, drawBeam, endBeams } from './client/utilities/lighting';"
          : undefined,
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });
const { game, beginBeams, drawBeam, endBeams } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

await bundle.close();

const canvas = new PixelCanvas();

canvas.isConnected = true;
game.canvas = canvas;
game.ctx = canvas.paint;
game.scale = 1;
const path = new Path2D();

const options = {
  ctx: game.ctx,
  path,
  lit: path,
  color: '#fff',
  reach: 100,
  spread: 10,
  activationProgress: 1,
};

for (const progress of [1, 0.4]) {
  beginBeams();
  options.activationProgress = progress;
  drawBeam(options);
  const surface = created.find((item) => item.className === 'world-beams')!;
  const single = surface.value;

  assert.ok(single > 0);
  assert.ok(
    Math.abs(single - progress * 0.5) < 1e-10,
    'the strength of a single beam is unchanged',
  );
  drawBeam(options);
  const overlap = surface.value;
  const singleWash = single * 0.5;
  const overlapWash = overlap * 0.5;
  const originalOverlap = 1 - (1 - singleWash) ** 2;
  const share = (overlapWash - singleWash) / (originalOverlap - singleWash);

  assert.ok(overlap > single, 'overlapping beams gently increase brightness');
  assert.ok(
    share > 0 && share < 1,
    'the increase stays much smaller than ordinary alpha blending',
  );

  options.activationProgress = progress / 2;
  drawBeam(options);
  assert.ok(surface.value > overlap, 'a dimmer overlapping beam adds light');
  endBeams();
}
