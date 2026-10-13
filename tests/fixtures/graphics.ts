import { WorldRenderer } from '../../src/client/utilities/world-renderer';
import { DrawingPath } from '../../src/client/utilities/drawing-path';
import { Station } from '../../src/client/objects/station';
import { game } from '../../src/client/game';
import { renderingLayers } from '../../src/specs/rendering-layers';
import {
  beginSurfaces,
  endSurfaces,
} from '../../src/client/utilities/composited-surface';

const createPath = () => new DrawingPath();

export const checkStationBay = () => {
  const canvas = document.createElement('canvas');
  const reference = document.createElement('canvas');
  const previous = { canvas: game.canvas, ctx: game.ctx, scale: game.scale };
  const station = new Station();
  const glow: number[][] = station.segments.find(
    (segment) => segment.glow,
  ).glow;
  const seam = glow.reduce((sum, [x]) => sum + x, 0) / glow.length;

  canvas.width = canvas.height = reference.width = reference.height = 768;
  document.body.append(canvas);
  game.scale = 1.5;

  const render = (target: HTMLCanvasElement, rotation: number) => {
    game.canvas = target;
    game.ctx = target.getContext('2d');
    game.ctx.clearRect(0, 0, 768, 768);
    game.ctx.save();
    game.ctx.translate(384, 384);
    game.ctx.scale(game.scale, game.scale);
    station.rotation = rotation;
    beginSurfaces();

    for (const zIndex of Object.values(renderingLayers)) {
      station.render({ zIndex, guide: false });
    }

    endSurfaces();
    game.ctx.restore();
    return game.ctx.getImageData(0, 0, 768, 768).data;
  };

  try {
    return [0, Math.PI - 0.17, Math.PI / 2].map((rotation) => {
      const actual = render(canvas, rotation);
      const expected = render(reference, rotation);

      const difference = Math.max(
        ...[-8, 0, 8].flatMap((offset) => {
          const x = Math.round(
            384 + (seam + offset) * game.scale * Math.cos(rotation),
          );
          const y = Math.round(
            384 + (seam + offset) * game.scale * Math.sin(rotation),
          );

          return Array.from({ length: 4 }, (_, channel) =>
            Math.abs(
              actual[(y * 768 + x) * 4 + channel] -
                expected[(y * 768 + x) * 4 + channel],
            ),
          );
        }),
      );

      return { rotation, difference };
    });
  } finally {
    beginSurfaces();
    endSurfaces();
    canvas.parentNode.removeChild(canvas);
    Object.assign(game, previous);
  }
};

export const checkStationGuideCache = () => {
  const canvas = document.createElement('canvas');
  const previous = { canvas: game.canvas, ctx: game.ctx, scale: game.scale };
  const clearRect = Reflect.get(
    CanvasRenderingContext2D.prototype,
    'clearRect',
  );
  const repaints = new WeakMap<HTMLCanvasElement, number>();
  const station = new Station();

  canvas.width = canvas.height = 128;
  document.body.append(canvas);
  game.canvas = canvas;
  game.ctx = canvas.getContext('2d');
  game.scale = 1;

  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    repaints.set(this.canvas, (repaints.get(this.canvas) || 0) + 1);
    return clearRect.apply(this, args);
  };

  const render = () => {
    beginSurfaces();
    station.render({ zIndex: renderingLayers.stationFloor });
    endSurfaces();
    const guide = canvas.previousElementSibling as HTMLCanvasElement;

    return [repaints.get(guide), guide.style.transform];
  };

  try {
    const initial = render();

    station.position.x += 10;
    station.rotation += Math.PI / 180;
    const minor = render();

    station.rotation += Math.PI / 18;
    const major = render();

    station.segments[0].health -= 1;
    const damaged = render();

    game.scale = 1.5;
    const resized = render();

    return [initial, minor, major, damaged, resized];
  } finally {
    CanvasRenderingContext2D.prototype.clearRect = clearRect;
    beginSurfaces();
    endSurfaces();
    canvas.parentNode.removeChild(canvas);
    Object.assign(game, previous);
  }
};

/*
 * Compare flat interior pixels with the native canvas renderer. Edge smoothing
 * may differ slightly; holes, clipping, blending, uploads, and order must agree.
 */
export const checkGraphics = async () => {
  const nativeCanvas = document.createElement('canvas');
  const worldCanvas = document.createElement('canvas');

  nativeCanvas.width = worldCanvas.width = 96;
  nativeCanvas.height = worldCanvas.height = 96;
  const native = nativeCanvas.getContext('2d', { willReadFrequently: true });
  const renderer = WorldRenderer.create(worldCanvas);

  if (!renderer) throw Error('The graphics regression check requires WebGL2');
  const world = renderer as unknown as CanvasRenderingContext2D;
  const image = document.createElement('canvas');

  image.width = image.height = 32;

  const paint = image.getContext('2d');

  paint.fillStyle = 'rgba(255,0,0,0.25)';
  paint.fillRect(0, 0, 32, 32);

  const bitmap = await createImageBitmap(image);

  const cases: {
    name: string;
    probes: number[][];
    draw: (ctx: CanvasRenderingContext2D) => void;
  }[] = [
    {
      name: 'concave fill and draw order',
      probes: [
        [20, 20],
        [20, 60],
        [60, 20],
        [60, 60],
        [40, 20],
      ],
      draw: (ctx) => {
        const path = createPath();

        path.moveTo(8, 8);
        path.lineTo(80, 8);
        path.lineTo(80, 32);
        path.lineTo(32, 32);
        path.lineTo(32, 80);
        path.lineTo(8, 80);
        path.closePath();
        ctx.fillStyle = '#f00';
        ctx.fill(path);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(32, 8, 16, 16);
      },
    },
    {
      name: 'nonzero hole',
      probes: [
        [12, 12],
        [40, 40],
        [60, 60],
        [80, 80],
      ],
      draw: (ctx) => {
        const path = createPath();

        path.rect(8, 8, 64, 64);
        path.moveTo(24, 24);
        path.lineTo(24, 56);
        path.lineTo(56, 56);
        path.lineTo(56, 24);
        path.closePath();
        ctx.fillStyle = '#f00';
        ctx.fill(path);
      },
    },
    {
      name: 'evenodd overlap',
      probes: [
        [20, 20],
        [40, 40],
        [68, 68],
        [80, 80],
      ],
      draw: (ctx) => {
        const path = createPath();

        path.rect(8, 8, 48, 48);
        path.rect(32, 32, 40, 40);
        ctx.fillStyle = '#0f0';
        ctx.fill(path, 'evenodd');
      },
    },
    {
      name: 'nested clips and restore',
      probes: [
        [48, 48],
        [70, 48],
        [20, 48],
        [12, 80],
      ],
      draw: (ctx) => {
        const circle = createPath();
        const rectangle = createPath();

        circle.arc(48, 48, 24, 0, Math.PI * 2);
        rectangle.rect(32, 16, 32, 64);
        ctx.save();
        ctx.clip(circle);
        ctx.clip(rectangle);
        ctx.fillStyle = '#ff0';
        ctx.fillRect(0, 0, 96, 96);
        ctx.restore();
        ctx.fillStyle = '#0f0';
        ctx.fillRect(8, 72, 16, 16);
      },
    },
    {
      name: 'translucent lighten',
      probes: [
        [20, 20],
        [40, 40],
        [60, 60],
        [80, 80],
      ],
      draw: (ctx) => {
        ctx.save();
        ctx.fillStyle = '#e13';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(8, 8, 48, 48);
        ctx.globalCompositeOperation = 'lighten';
        ctx.fillStyle = '#1e3';
        ctx.globalAlpha = 0.4;
        ctx.fillRect(32, 32, 40, 40);
        ctx.restore();
      },
    },
    {
      name: 'gradient and transform',
      probes: [
        [16, 20],
        [40, 20],
        [64, 20],
        [48, 64],
        [80, 80],
      ],
      draw: (ctx) => {
        const gradient = ctx.createLinearGradient(8, 8, 72, 8);

        gradient.addColorStop(0, '#f00');
        gradient.addColorStop(0.5, '#0f0');
        gradient.addColorStop(1, '#00f');
        ctx.fillStyle = gradient;
        ctx.fillRect(8, 8, 64, 32);
        ctx.save();
        ctx.translate(48, 64);
        ctx.rotate(0.3);
        ctx.scale(1.5, 0.8);
        ctx.fillStyle = '#ff0';
        ctx.fillRect(-12, -12, 24, 24);
        ctx.restore();
      },
    },
    {
      name: 'translucent bitmap upload',
      probes: [
        [16, 16],
        [24, 24],
        [60, 60],
      ],
      draw: (ctx) => ctx.drawImage(bitmap, 8, 8),
    },
    ...['#f00', '#00f'].map((color) => ({
      name: `cropped changing image ${color}`,
      probes: [
        [20, 20],
        [40, 40],
        [60, 60],
      ],
      draw: (ctx: CanvasRenderingContext2D) => {
        paint.clearRect(0, 0, 32, 32);
        paint.fillStyle = color;
        paint.fillRect(4, 0, 16, 16);
        ctx.drawImage(image, 4, 0, 16, 16, 8, 8, 24, 24);
      },
    })),
  ];

  const results = cases.map(({ name, probes, draw }) => {
    native.clearRect(0, 0, 96, 96);
    renderer.clearRect();

    [native, world].forEach((ctx) => {
      ctx.fillStyle = '#123';
      ctx.fillRect(0, 0, 96, 96);
      draw(ctx);
    });

    renderer.present();
    renderer.getContextAttributes();
    const expected = native.getImageData(0, 0, 96, 96).data;
    const actual = new Uint8Array(96 * 96 * 4);

    renderer.gl.readPixels(
      0,
      0,
      96,
      96,
      renderer.gl.RGBA,
      renderer.gl.UNSIGNED_BYTE,
      actual,
    );
    const difference = Math.max(
      ...probes.flatMap(([x, y]) =>
        Array.from({ length: 4 }, (_, channel) =>
          Math.abs(
            expected[(y * 96 + x) * 4 + channel] -
              actual[((95 - y) * 96 + x) * 4 + channel],
          ),
        ),
      ),
    );

    return { name, difference };
  });

  const release = renderer.gl.getExtension('WEBGL_lose_context');

  if (release) Reflect.get(release, 'lose' + 'Context').call(release);
  bitmap.close();
  return results;
};
