import { circlePath, shapePath } from './drawing';
import { camera } from './camera';
import { colors } from './colors';
import { createPolygon } from './polygon';

/**
 * The sky behind everything: sparks of starlight and soft clouds of colour,
 * with nothing solid about any of it. None of it is ever collided with, so it
 * can be any size it likes.
 *
 * Each layer is drawn once into a square tile and then repeated across the
 * screen as a pattern, which is why it costs one fill a layer however much is
 * in it. A layer slides past at a fraction of the camera's own movement, so
 * the further back it is the slower it goes and the deeper the sky looks.
 */

// World units across a tile. Bigger repeats less obviously and costs more
// memory, and this is already wider than the screen
const tile = 1200;

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

const dotTints = [colors.red[2], colors.orange[2], colors.cyan[2]];
const sparkleTints = [colors.yellow[2], colors.orange[2], colors.cyan[2], colors.pink[2]];
const cloudColors = [colors.violet[1], colors.indigo[1], colors.cyan[1], colors.purple[2]];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const starColor = (tints) => (Math.random() < tinted ? pick(tints) : colors.white[2]);

// Eight points around alternating radiuses makes a four pointed sparkle. The
// long ones go on the even corners, which are the ones straight up and along,
// so it comes out as a + rather than an x
const starPath = (size) => shapePath(createPolygon({
  points: 8,
  radius: size * 0.7,
  radiusEven: size * 4,
}));

/**
 * Draw something nine times over, so that whatever lands near an edge of the
 * tile carries on across the join when it repeats.
 */
const wrapped = (draw) => {
  for (let x = -1; x < 2; x++) {
    for (let y = -1; y < 2; y++) draw(x * tile, y * tile);
  }
};

const makePattern = ({ clouds, dots, size, sparkles }) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = tile;
  canvas.height = tile;

  Array.from({ length: clouds }).forEach(() => {
    const color = pick(cloudColors);
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

  Array.from({ length: dots }).forEach(() => {
    const color = starColor(dotTints);
    const path = circlePath(size * (0.4 + Math.random() * 0.6));
    const x = Math.random() * tile;
    const y = Math.random() * tile;

    // Varying how faint each one is does more for the depth than varying how
    // big it is, at this sort of size
    ctx.globalAlpha = 0.3 + Math.random() * 0.7;
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

  Array.from({ length: sparkles }).forEach(() => {
    const color = starColor(sparkleTints);
    const path = starPath(size * (1 + Math.random()));
    const x = Math.random() * tile;
    const y = Math.random() * tile;

    // No stroke on a sparkle, so it stays a glow rather than an outline, and
    // never quite full strength or it sits in front of the sky rather than in
    ctx.globalAlpha = 0.6 + Math.random() * 0.3;
    ctx.fillStyle = color;
    ctx.shadowColor = color;

    wrapped((offsetX, offsetY) => {
      ctx.save();
      ctx.translate(x + offsetX, y + offsetY);
      ctx.fill(path);
      ctx.restore();
    });
  });

  return ctx.createPattern(canvas, 'repeat');
};

const patterns = layers.map(makePattern);

export const renderBackground = (game) => {
  const { ctx } = game;

  layers.forEach(({ depth }, i) => {
    const x = camera.x * depth;
    const y = camera.y * depth;

    ctx.save();
    ctx.scale(game.scale, game.scale);
    // Shifting the pattern rather than the camera is what makes a layer lag
    // behind everything in front of it
    ctx.translate(-x, -y);
    ctx.fillStyle = patterns[i];
    ctx.fillRect(x, y, game.width, game.height);
    ctx.restore();
  });
};
