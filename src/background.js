import { circlePath, sparklePath } from './drawing';
import { camera } from './camera';
import { colors } from './colors';

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
// Backing pixels per world unit, so stars stay sharp when the game is scaled.
const resolution = 2;

// How much of the camera's movement each layer takes, and what is in it.
// Barely any of it, because all of this is a very long way off. The layers sit
// close together too, so the nearest reads as far away rather than as near.
// Most of the sky is plain white specks, and only a handful of stars are near
// enough to flare out into a coloured sparkle
const layers = [
  { clouds: 4, depth: 0.02, dots: 150, size: 1, sparkles: 10 },
  { clouds: 3, depth: 0.04, dots: 100, size: 1.2, sparkles: 8 },
  { clouds: 2, depth: 0.06, dots: 70, size: 1.4, sparkles: 6 },
];

// A speck gets a touch of bloom and a sparkle a proper halo, so that none of
// it looks like a shape cut out of paper
const dotGlow = 3;
const sparkleGlow = 6;

// How many of the stars are anything other than plain white
const tinted = 0.15;

const dotTints = [colors.yellow[2], colors.orange[2], colors.cyan[2], colors.red[2]];
const sparkleTints = [colors.yellow[2], colors.orange[2], colors.cyan[2], colors.violet[2]];
const cloudColors = [colors.violet[1], colors.indigo[1], colors.cyan[1], colors.purple[2]];

const starColor = (tints) => (Math.random() < tinted ?
  tints[Math.floor(Math.random() * tints.length)] :
  colors.white[2]);

// What the sky can be built out of. A part is left out of the tile altogether
// rather than skipped while drawing, so what a mode costs is what is in the
// sky rather than how many blits it takes to put it there
const modes = [
  { label: 'SKY: ALL', parts: ['clouds', 'dots', 'sparkles'] },
  { label: 'SKY: FOG', parts: ['clouds'] },
  { label: 'SKY: DOTS', parts: ['dots'] },
  { label: 'SKY: SPARKLES', parts: ['sparkles'] },
  { label: 'SKY: OFF', parts: [] },
];

let mode = 0;

/**
 * Draw something nine times over, so that whatever lands near an edge of the
 * tile carries on across the join when it repeats.
 */
const wrapped = (draw) => {
  for (let x = -1; x < 2; x++) {
    for (let y = -1; y < 2; y++) draw(x * tile, y * tile);
  }
};

const makeTile = ({ clouds, dots, size, sparkles }, parts) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.height = tile * resolution;
  ctx.scale(resolution, resolution);

  if (parts.includes('clouds')) Array.from({ length: clouds }).forEach(() => {
    const color = cloudColors[Math.floor(Math.random() * cloudColors.length)];
    const radius = tile / 5 + Math.random() * tile / 4;
    const x = Math.random() * tile;
    const y = Math.random() * tile;

    wrapped((offsetX, offsetY) => {
      const at = [x + offsetX, y + offsetY];
      // Fading all the way out to nothing is what keeps a cloud an edgeless
      // smudge rather than a circle
      const fade = ctx.createRadialGradient(...at, 0, ...at, radius);

      fade.addColorStop(0, `${color}2`);
      fade.addColorStop(1, `${color}0`);
      ctx.fillStyle = fade;
      ctx.fillRect(at[0] - radius, at[1] - radius, radius * 2, radius * 2);
    });
  });

  ctx.shadowBlur = dotGlow;

  if (parts.includes('dots')) Array.from({ length: dots }).forEach(() => {
    const color = starColor(dotTints) + '3456789abc'[Math.floor(Math.random() * 10)];
    const path = circlePath(size * (0.4 + Math.random() * 0.6));
    const x = Math.random() * tile;
    const y = Math.random() * tile;

    // Varying how faint each one is does more for the depth than varying how
    // big it is, at this sort of size
    ctx.fillStyle = color;
    ctx.shadowColor = color;

    wrapped((offsetX, offsetY) => {
      ctx.save();
      ctx.translate(x + offsetX, y + offsetY);
      ctx.fill(path);
      ctx.restore();
    });
  });

  ctx.shadowBlur = sparkleGlow;

  if (parts.includes('sparkles')) Array.from({ length: sparkles }).forEach(() => {
    const color = starColor(sparkleTints) + '789abc'[Math.floor(Math.random() * 6)];
    const path = sparklePath(size * (1 + Math.random()));
    const x = Math.random() * tile;
    const y = Math.random() * tile;

    // No stroke on a sparkle, so it stays a glow rather than an outline, and
    // never quite full strength or it sits in front of the sky rather than in
    ctx.fillStyle = color;
    ctx.shadowColor = color;

    wrapped((offsetX, offsetY) => {
      ctx.save();
      ctx.translate(x + offsetX, y + offsetY);
      ctx.fill(path);
      ctx.restore();
    });
  });

  return canvas;
};

const tilesOf = (parts) => layers.map((layer) => makeTile(layer, parts));

let tiles;

// A canvas can be held as the list of drawing commands that filled it and
// replayed on every blit, which makes a tile cost whatever it took to draw
// rather than what it looks like. A bitmap is pixels and nothing else
const build = () => {
  const built = tilesOf(modes[mode].parts);

  tiles = built;
  built.forEach((canvas, i) => createImageBitmap(canvas).then((bitmap) => {
    if (tiles === built) built[i] = bitmap;
  }));
};

build();

// Which parts of the sky are being drawn, and a way to step through them, so
// that what each one costs can be read off the frame rate one at a time
export const sky = {
  cycle: () => {
    mode = (mode + 1) % modes.length;
    build();
    sky.label = modes[mode].label;
  },
  label: modes[mode].label,
};

/**
 * Stamped out rather than filled as a repeating pattern: a pattern under a
 * scaled transform is resampled across the whole screen every frame, which
 * costs more than everything else in the game put together.
 */
export const renderBackground = (game) => {
  const { canvas, ctx, scale } = game;

  if (!modes[mode].parts.length) return;

  // Whole screen pixels, and a whole number of them across, so that two tiles
  // meeting never leave a hairline of background showing between them
  const span = Math.round(tile * scale);
  // Tile pixels per screen pixel, for cutting a stamp down to its visible part
  const back = tile * resolution / span;

  layers.forEach(({ depth }, i) => {
    // Shifting the sky rather than the camera is what makes a layer lag behind
    // everything in front of it
    const x = camera.x * depth;
    const y = camera.y * depth;
    const left = -(Math.round((x - Math.floor(x / tile) * tile) * scale) % span);
    const top = -(Math.round((y - Math.floor(y / tile) * tile) * scale) % span);

    for (let atX = left; atX < canvas.width; atX += span) {
      for (let atY = top; atY < canvas.height; atY += span) {
        // Only the part of a stamp that lands on screen. A tile is wider than
        // the screen, so most of one is waste to a browser that does not clip
        // it away for itself
        const toX = Math.max(atX, 0);
        const toY = Math.max(atY, 0);
        const width = Math.min(atX + span, canvas.width) - toX;
        const height = Math.min(atY + span, canvas.height) - toY;

        ctx.drawImage(
          tiles[i],
          (toX - atX) * back,
          (toY - atY) * back,
          width * back,
          height * back,
          toX,
          toY,
          width,
          height,
        );
      }
    }
  });
};
