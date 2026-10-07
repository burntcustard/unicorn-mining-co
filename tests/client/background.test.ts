import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { rolldown } from 'rolldown';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

for (const production of [false, true]) {
  const drawings: unknown[][] = [];
  const pending: (() => void)[] = [];

  const bitmaps: { closed: boolean; close: () => void }[] = [];

  const browser = createContext({
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

        return { getContext: () => context };
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

  // Hold the same world position at the centre, as the camera does on zoom.
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
}

console.log(
  'Background layout survives zoom and resize in development and production',
);
