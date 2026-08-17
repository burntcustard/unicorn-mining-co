import { renderText } from './text';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  '0123456789',
  '!%(),-/>',
];

export const textDemo = (game) => {
  renderText({
    alignCenter: true,
    ctx: game.ctx,
    scale: game.scale,
    text: 'Hello world',
    x: game.width / 2,
    y: game.height / 2,
  });

  charset.forEach((text, i) => {
    renderText({
      alignCenter: true,
      ctx: game.ctx,
      scale: game.scale,
      text,
      x: game.width / 2,
      y: game.height / 2 + 40 + i * 20,
    });
  });
};
