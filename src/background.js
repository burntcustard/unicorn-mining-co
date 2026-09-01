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
// Final screen pixels across a tile, rebuilt whenever the display scale changes
let span;

// How much of the camera's movement each layer takes, and what is in it.
// Barely any of it, because all of this is a very long way off. The layers sit
// close together too, so the nearest reads as far away rather than as near.
// Most of the sky is plain white specks, and only a handful of stars are near
// enough to flare out into a coloured sparkle
const dotCounts = [150, 100, 70];

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
  tints[Math.floor(Math.random() * 4)] :
  colors.white[2]);

// Every layer, drawn in full. Debug builds can swap this out for a cut-down
// mode to see what each part of the sky costs
// @ifdef DEBUG
const fullParts = ['clouds', 'dots', 'sparkles'];

// Which parts of the sky are being drawn, and a label for them, so that what
// each one costs can be read off the frame rate one at a time
export const sky = {
  label: 'ALL',
  parts: fullParts,
};
// @endif

const makeTile = (clouds, dots, size, sparkles,
  // @ifdef DEBUG
  parts,
  // @endif
) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.height = span;
  ctx.scale(span / tile, span / tile);

  // @ifdef DEBUG
  if (parts.includes('clouds')) {
  // @endif
    while (clouds--) {
      const color = cloudColors[Math.floor(Math.random() * 4)];
      const radius = tile / 5 + Math.random() * tile / 4;
      const x = Math.random() * tile;
      const y = Math.random() * tile;

      for (let wrapped = 9; wrapped--;) {
        const at = [
          x + wrapped % 3 * tile - tile,
          y + Math.floor(wrapped / 3) * tile - tile,
        ];
        // Fading all the way out to nothing is what keeps a cloud an edgeless
        // smudge rather than a circle
        const fade = ctx.createRadialGradient(...at, 0, ...at, radius);

        fade.addColorStop(0, `${color}2`);
        fade.addColorStop(1, `${color}0`);
        ctx.fillStyle = fade;
        ctx.fillRect(at[0] - radius, at[1] - radius, radius * 2, radius * 2);
      }
    }
  // @ifdef DEBUG
  }
  // @endif

  ctx.shadowBlur = dotGlow;

  // @ifdef DEBUG
  if (parts.includes('dots')) {
  // @endif
    while (dots--) {
      const color = starColor(dotTints) + '3456789'[Math.floor(Math.random() * 7)];
      const path = circlePath(size * (0.4 + Math.random() * 0.6));
      const x = Math.random() * tile;
      const y = Math.random() * tile;

      // Varying how faint each one is does more for the depth than varying how
      // big it is, at this sort of size
      ctx.fillStyle = color;
      ctx.shadowColor = color;

      for (let wrapped = 9; wrapped--;) {
        ctx.save();
        ctx.translate(
          x + wrapped % 3 * tile - tile,
          y + Math.floor(wrapped / 3) * tile - tile,
        );
        ctx.fill(path);
        ctx.restore();
      }
    }
  // @ifdef DEBUG
  }
  // @endif

  ctx.shadowBlur = sparkleGlow;

  // @ifdef DEBUG
  if (parts.includes('sparkles')) {
  // @endif
    while (sparkles--) {
      const color = starColor(sparkleTints) + '6789ab'[Math.floor(Math.random() * 6)];
      const path = sparklePath(size * (1 + Math.random()));
      const x = Math.random() * tile;
      const y = Math.random() * tile;

      // No stroke on a sparkle, so it stays a glow rather than an outline, and
      // never quite full strength or it sits in front of the sky rather than in
      ctx.fillStyle = color;
      ctx.shadowColor = color;

      for (let wrapped = 9; wrapped--;) {
        ctx.save();
        ctx.translate(
          x + wrapped % 3 * tile - tile,
          y + Math.floor(wrapped / 3) * tile - tile,
        );
        ctx.fill(path);
        ctx.restore();
      }
    }
  // @ifdef DEBUG
  }
  // @endif

  return canvas;
};

let tiles;

// A canvas can be held as the list of drawing commands that filled it and
// replayed on every blit, which makes a tile cost whatever it took to draw
// rather than what it looks like. A bitmap is pixels and nothing else
const build = () => {
  tiles = dotCounts.map((dots, i) => makeTile(
    4 - i, dots, 1 + i / 5, 10 - i * 2,
    // @ifdef DEBUG
    sky.parts,
    // @endif
  ));

  tiles.forEach((canvas, i) => createImageBitmap(canvas).then((bitmap) => {
    if (tiles[i] === canvas) tiles[i] = bitmap;
  }));
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
export const renderBackground = (game) => {
  const { canvas, ctx, scale } = game;
  const size = Math.round(tile * scale);

  if (span !== size) {
    span = size;
    build();
  }

  // @ifdef DEBUG
  if (!sky.parts.length) return;
  // @endif

  tiles.forEach((_, i) => {
    // Each layer shifts by (i + 1) / 50 of the camera, so distant sky lags.
    // `-(offset % span + span) % span` wraps it into [-span, 0], equivalent to
    // `-(offset - Math.floor(offset / span) * span)` for either sign, but leaves
    // it unsnapped; stamping every `span` pixels then covers the viewport.
    const left = -(camera.x * (i + 1) * scale / 50 % span + span) % span;
    const top = -(camera.y * (i + 1) * scale / 50 % span + span) % span;

    for (let atX = left; atX < canvas.width; atX += span) {
      for (let atY = top; atY < canvas.height; atY += span) {
        // Canvas clips whatever falls outside the screen
        ctx.drawImage(tiles[i], atX, atY);
      }
    }
  });
};
