import { graphics } from '../ui/dom/graphics';
import { withAlpha } from '../utilities/color';
import { circlePath, sparklePath } from '../utilities/drawing';
import { colors } from '../../specs/colors';
import { seededRandom } from '../utilities/seeded-random';

/**
 * The sky behind everything: sparks of starlight and soft clouds of colour,
 * with nothing solid about any of it. None of it is ever collided with, so it
 * can be any size it likes.
 *
 * Each layer is drawn once into a square tile and then stamped across the
 * screen, which is why it costs a handful of blits a layer however much is in
 * it. A layer slides past at a fraction of the camera's own movement, so the
 * further back it is the slower it goes and the deeper the sky looks.
 */

// World units across a tile. Bigger repeats less obviously and costs more
// memory, and this is already wider than the screen
const tile = 1200;
// Final screen pixels across a tile, rebuilt whenever the display scale changes
let span: number | undefined;

// How much of the camera's movement each layer takes, and what is in it.
// Barely any of it, because all of this is a very long way off. The layers sit
// close together too, so the nearest reads as far away rather than as near.
// Most of the sky is fine coloured specks, and only a handful of stars are near
// enough to flare out into a coloured sparkle
const dotCounts = [550, 380, 230];

type Tile = HTMLCanvasElement | ImageBitmap;

type Sky = { label: string; parts: string[]; cycle?: () => void };

const dotTints = [
  colors.yellow[2],
  colors.violet[2],
  colors.cyan[2],
  colors.indigo[1],
  colors.white[2],
];
const sparkleTints = [
  colors.red[2],
  colors.orange[2],
  colors.violet[2],
  colors.cyan[2],
  colors.violet[2],
  colors.orange[2],
  colors.violet[2],
  colors.cyan[2],
];
const cloudColors = [
  colors.violet[1],
  colors.indigo[1],
  colors.cyan[0],
  colors.indigo[1],
];

// Every layer, drawn in full. Debug builds can swap this out for a cut-down
// mode to see what each part of the sky costs
// @ifdef DEBUG
const fullParts = ['clouds', 'dots', 'sparkles'];

// Which parts of the sky are being drawn, and a label for them, so that what
// each one costs can be read off the frame rate one at a time
export const sky: Sky = {
  label: 'ALL',
  parts: fullParts,
};
// @endif

const makeTile = ({
  clouds,
  dots,
  size,
  sparkles,
  seed,
  // @ifdef DEBUG
  parts,
  // @endif
}: {
  clouds: number;
  dots: number;
  size: number;
  sparkles: number;
  seed: number;
  // @ifdef DEBUG
  parts: string[];
  // @endif
}) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // A visual seed is available before the world loads. Replaying it keeps
  // the sky identical when tiles are redrawn at a different pixel scale.
  const random = seededRandom(seed);

  // Every mark fits within half a tile (clouds reach at most 440 units).
  // Centred positions need only the original and its positive-axis copies.
  const wrappedPaint = (paint: () => void) => {
    const x = (random() - 0.5) * tile;
    const y = (random() - 0.5) * tile;

    for (let wrapped = 4; wrapped--;) {
      ctx.save();
      ctx.translate(
        x + (wrapped % 2) * tile,
        y + Math.floor(wrapped / 2) * tile,
      );
      paint();
      ctx.restore();
    }
  };

  canvas.width = canvas.height = span;
  ctx.scale(span / tile, span / tile);

  // @ifdef DEBUG
  if (parts.includes('clouds')) {
    // @endif
    while (graphics[1] && clouds--) {
      const color = cloudColors[Math.floor(random() * 4)];
      const radius = 120 + random() ** 2 * 320;

      wrappedPaint(() => {
        // Broad washes overlap medium patches at low opacity, leaving the
        // stars clear. Wrapped copies keep the edges seamless.
        const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);

        fade.addColorStop(0, withAlpha({ color, alpha: 0.1 }));
        fade.addColorStop(1, withAlpha({ color, alpha: 0 }));
        ctx.fillStyle = fade;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      });
    }
    // @ifdef DEBUG
  }
  // @endif

  // @ifdef DEBUG
  if (parts.includes('dots')) {
    // @endif
    while (graphics[0] && dots--) {
      const color = withAlpha({
        color: dotTints[Math.floor(random() * 5)],
        alpha: 0.5,
      });

      const path = circlePath(size * random());

      // Small radii and a shared low opacity keep the pinpricks behind
      // the larger sparkles.
      ctx.fillStyle = color;

      wrappedPaint(() => {
        ctx.fill(path);
      });
    }
    // @ifdef DEBUG
  }
  // @endif

  ctx.globalCompositeOperation = 'lighter';
  // A sparkle's glow is painted, not shadowed, and the whole of one is a
  // little see-through so the clouds behind still read through it
  ctx.globalAlpha = 0.4;

  // @ifdef DEBUG
  if (parts.includes('sparkles')) {
    // @endif
    while (graphics[2] && sparkles--) {
      const color = sparkleTints[Math.floor(random() * 8)];
      const radius = size * (1 + random() * 2);
      const path = sparklePath(radius * 1.4, 0.4);
      const halo = circlePath(radius * 10);

      // The x joins the + as a second subpath rather than a second fill, so
      // nonzero winding paints where they cross once instead of adding it up
      path.addPath(sparklePath(radius * 0.7, 0.7), {
        a: 0.7,
        b: 0.7,
        c: -0.7,
        d: 0.7,
      });

      wrappedPaint(() => {
        // One bloom, bright and tight at the middle and trailing off well past
        // the rays, then the star itself out of a white core. The stops bend
        // the falloff off a straight ramp, which would leave a faint rim where
        // it ran out
        const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 10);

        bloom.addColorStop(0, withAlpha({ color, alpha: 0.7 }));
        bloom.addColorStop(0.1, withAlpha({ color, alpha: 0.2 }));
        bloom.addColorStop(0.4, withAlpha({ color, alpha: 0.1 }));
        bloom.addColorStop(1, withAlpha({ color, alpha: 0 }));
        ctx.fillStyle = bloom;

        ctx.fill(halo);

        const rays = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 5);

        rays.addColorStop(0, colors.white[2]);
        rays.addColorStop(0.1, color);
        rays.addColorStop(1, withAlpha({ color, alpha: 0 }));
        ctx.fillStyle = rays;
        ctx.fill(path);
        // A smaller white copy brightens the middle using the same shape.
        ctx.fillStyle = colors.white[2];
        ctx.globalAlpha = 0.3;
        ctx.scale(0.35, 0.35);
        ctx.fill(path);
      });
    }
    // @ifdef DEBUG
  }
  // @endif

  return canvas;
};

let tiles: Tile[];

window.addEventListener('ui-graphics', () => {
  span = undefined;
});

// A canvas can be held as the list of drawing commands that filled it and
// replayed on every blit, which makes a tile cost whatever it took to draw
// rather than what it looks like. A bitmap is pixels and nothing else
const build = () => {
  tiles?.forEach((image) => {
    if ('close' in image) image.close();
  });

  tiles = dotCounts.map((dots, i) =>
    makeTile({
      clouds: 16 + i * 4,
      dots,
      size: 1 + i / 5,
      sparkles: 16 - i * 4,
      seed: i + 1,
      // @ifdef DEBUG
      parts: sky.parts,
      // @endif
    }),
  );

  tiles.forEach((canvas, i) =>
    createImageBitmap(canvas).then((bitmap) => {
      if (tiles[i] === canvas) tiles[i] = bitmap;
      else bitmap.close();
    }),
  );
};

// @ifdef DEBUG
// What the sky can be built out of. A part is left out of the tile altogether
// rather than skipped while drawing, so what a mode costs is what is in the
// sky rather than how many blits it takes to put it there
const modes = [
  { label: 'ALL', parts: fullParts },
  { label: 'FOG', parts: ['clouds'] },
  { label: 'DOTS', parts: ['dots'] },
  { label: 'SPARKLES', parts: ['sparkles'] },
  { label: 'OFF', parts: [] },
];

let mode = 0;

// Steps through the modes above, so that what each one costs can be read off
// the frame rate one at a time
sky.cycle = () => {
  mode = (mode + 1) % modes.length;
  sky.label = modes[mode].label;
  sky.parts = modes[mode].parts;
  build();
};
// @endif

/**
 * Stamped out rather than filled as a repeating pattern: a pattern under a
 * scaled transform is resampled across the whole screen every frame, which
 * costs more than everything else in the game put together.
 */
export const renderBackground = (
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  scale: number,
  cameraX = 0,
  cameraY = 0,
) => {
  const size = Math.round(tile * scale);

  if (span !== size) {
    span = size;
    build();
  }

  // @ifdef DEBUG
  if (!sky.parts.length) return;
  // @endif

  tiles.forEach((image, i) => {
    // Centre the tile in the viewport and follow the camera's world centre,
    // so zooming around that centre does not shift the sky. Each layer moves
    // by (i + 1) / 50 of the camera, so distant sky lags.
    const offsetX =
      ((cameraX * scale + canvas.width / 2) * (i + 1)) / 50 -
      (canvas.width - span) / 2;
    const offsetY =
      ((cameraY * scale + canvas.height / 2) * (i + 1)) / 50 -
      (canvas.height - span) / 2;

    // `-(offset % span + span) % span` wraps it into [-span, 0], equivalent to
    // `-(offset - Math.floor(offset / span) * span)` for either sign, but leaves
    // it unsnapped; stamping every `span` pixels then covers the viewport.
    const left = -((offsetX % span) + span) % span;
    const top = -((offsetY % span) + span) % span;

    for (let atX = left; atX < canvas.width; atX += span) {
      for (let atY = top; atY < canvas.height; atY += span) {
        // Canvas clips whatever falls outside the screen
        ctx.drawImage(image, atX, atY);
      }
    }
  });
};
