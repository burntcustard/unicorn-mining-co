import { colors } from './colors';

/**
 * Demo the colors by showing a swatch of each shade in the top right corner of the canvas.
 * @param {*} game game object
 */
export const colorsDemo = (game) => {
  const { ctx } = game;
  const swatch = 16;
  const gap = 2;
  const margin = 10;
  const shades = Object.values(colors);
  const left = game.uiWidth - margin - 5 * (swatch + gap);
  const top = margin;

  ctx.save();
  ctx.scale(game.uiScale, game.uiScale);

  shades.forEach((color, row) => {
    color.forEach((shade, column) => {
      ctx.fillStyle = shade;
      ctx.fillRect(
        left + column * (swatch + gap),
        top + row * (swatch + gap),
        swatch,
        swatch,
      );
    });
  });

  ctx.restore();
};
