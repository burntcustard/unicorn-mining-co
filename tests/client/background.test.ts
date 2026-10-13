import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { rolldown } from 'rolldown';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

for (const production of [false, true]) {
  const drawings: unknown[][] = [];
  const pending: (() => void)[] = [];

  const bitmaps: { closed: boolean; close: () => void }[] = [];

  const browser = createContext({
    window: new EventTarget(),
    document: {
      createElement: () => {
        const commands: unknown[] = [];

        drawings.push(commands);

        const record =
          (name: string) =>
          (...args: unknown[]) => {
            commands.push([name, ...args]);
          };

        const context = new Proxy(
          {
            createRadialGradient: (...args: number[]) => {
              record('gradient')(...args);
              return { addColorStop: record('stop') };
            },
          },
          {
            get: (target, key: string) =>
              Reflect.get(target, key) ?? record(key),
            set: (_target, key, value) => {
              if (typeof value !== 'object') commands.push([key, value]);
              return true;
            },
          },
        );

        return {
          style: {},
          setAttribute() {},
          getContext: () => context,
        };
      },
    },
    Path2D: class {
      commands: unknown[] = [];

      addPath(...args: unknown[]) {
        this.commands.push(['addPath', ...args]);
      }

      arc(...args: number[]) {
        this.commands.push(['arc', ...args]);
      }

      closePath() {}

      lineTo(...args: number[]) {
        this.commands.push(['lineTo', ...args]);
      }
    },
    createImageBitmap: () =>
      new Promise((resolve) => {
        const bitmap = {
          closed: false,
          close: () => {
            bitmap.closed = true;
          },
        };

        bitmaps.push(bitmap);
        pending.push(() => resolve(bitmap));
      }),
    requestAnimationFrame: () => 0,
  });

  const bundle = await rolldown({
    input: 'src/client/background/background.ts',
    plugins: production
      ? [
          {
            name: 'production-flags',
            transform: (source) => stripIfdef(source),
          },
        ]
      : [],
  });

  const { output } = await bundle.generate({
    format: 'iife',
    name: 'background',
  });

  await bundle.close();
  runInContext(output[0].code, browser);
  const background = runInContext(
    'background',
    browser,
  ) as typeof import('../../src/client/background/background');
  const canvas = { width: 1080, height: 1080 } as HTMLCanvasElement;

  const stamps: number[][] = [];

  const ctx = {
    clearRect() {},
    drawImage(_image: unknown, x: number, y: number) {
      stamps.push([x, y]);
    },
  } as unknown as CanvasRenderingContext2D;

  background.renderBackground(canvas, ctx, 1);
  const layers = drawings.length;
  const layout = () =>
    JSON.stringify(
      drawings.slice(-layers).map((commands) => commands.slice(1)),
    );
  const initialLayout = layout();

  assert(layers > 0);
  canvas.width = 3840;
  background.renderBackground(canvas, ctx, 1, -123, 456);
  assert.equal(
    drawings.length,
    layers,
    'resize and pan reuse tiles at the same scale',
  );
  background.renderBackground(canvas, ctx, 0.5);
  assert.equal(
    layout(),
    initialLayout,
    'zooming out preserves stars and clouds',
  );
  pending.splice(0).forEach((resolve) => resolve());
  await Promise.resolve();
  assert(
    bitmaps.slice(0, layers).every((bitmap) => bitmap.closed),
    'stale asynchronous bitmaps are released',
  );
  assert(bitmaps.slice(layers).every((bitmap) => !bitmap.closed));

  background.renderBackground(canvas, ctx, 2);
  assert.equal(
    layout(),
    initialLayout,
    'zooming in preserves stars and clouds',
  );
  assert(
    bitmaps.slice(layers, layers * 2).every((bitmap) => bitmap.closed),
    'replaced bitmaps are released',
  );
  background.renderBackground(canvas, ctx, 1);
  assert.equal(
    layout(),
    initialLayout,
    'returning to the original zoom restores the same sky',
  );
  pending.splice(0).forEach((resolve) => resolve());
  await Promise.resolve();

  // Hold the same world position at the center, as the camera does on zoom.
  // The first layer's texture coordinate there must survive zoom and resize.
  for (const [width, height, scale] of [
    [1080, 1080, 1],
    [3840, 1080, 0.5],
    [1080, 3840, 2],
  ]) {
    canvas.width = width;
    canvas.height = height;
    stamps.length = 0;
    background.renderBackground(
      canvas,
      ctx,
      scale,
      100 - width / (2 * scale),
      -200 - height / (2 * scale),
    );
    const [left, top] = stamps[0];

    assert(Math.abs((((width / 2 - left) / scale) % 1200) - 602) < 1e-9);
    assert(Math.abs((((height / 2 - top) / scale) % 1200) - 596) < 1e-9);
  }

  pending.splice(0).forEach((resolve) => resolve());
  await Promise.resolve();

  // Connected sky layers slide without repainting while their margin covers
  // the view, then refresh their pixels after a longer pan or resize.
  let layersInPage: HTMLCanvasElement[] = [];

  const visible = {
    id: 'background-canvas',
    isConnected: true,
    width: 1080,
    height: 1080,
    clientWidth: 1080,
    style: {},
    after(...layers: HTMLCanvasElement[]) {
      layersInPage = layers;
    },
  } as unknown as HTMLCanvasElement;

  background.renderBackground(visible, ctx, 1);
  assert.equal(layersInPage.length, layers);
  const layerDrawings = drawings.slice(-layers);
  const paintCount = () =>
    layerDrawings.reduce((sum, commands) => sum + commands.length, 0);
  const firstPaints = paintCount();
  const transforms = layersInPage.map((layer) => layer.style.transform);

  background.renderBackground(visible, ctx, 1, 100, 100);
  assert.equal(paintCount(), firstPaints, 'small pans only move surfaces');
  assert.notDeepEqual(
    layersInPage.map((layer) => layer.style.transform),
    transforms,
    'each layer follows its own parallax speed',
  );
  background.renderBackground(visible, ctx, 1, 10000, 10000);
  assert(paintCount() > firstPaints, 'long pans refresh the covered margin');
  visible.width = 1440;
  background.renderBackground(visible, ctx, 1, 10000, 10000);
  assert(layersInPage.every((layer) => layer.width > visible.width));
}

console.log(
  'Background layout survives zoom and resize in development and production',
);
