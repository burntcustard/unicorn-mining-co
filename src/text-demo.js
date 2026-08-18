import { renderText } from './text';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  '0123456789',
  '!$%(),-/>',
];

export const textDemo = (game) => {
  renderText({
    alignCenter: true,
    ctx: game.ctx,
    scale: game.uiScale,
    text: 'Hello world',
    x: game.uiWidth / 2,
    y: game.uiHeight / 2,
  });

  charset.forEach((text, i) => {
    renderText({
      alignCenter: true,
      ctx: game.ctx,
      scale: game.uiScale,
      text,
      x: game.uiWidth / 2,
      y: game.uiHeight / 2 + 40 + i * 20,
    });
  });

  renderText({
    alignCenter: true,
    ctx: game.ctx,
    scale: game.uiScale,
    text: '$2000',
    x: game.uiWidth / 2,
    y: game.uiHeight / 2 + 140,
  });

  renderText({
    alignCenter: true,
    ctx: game.ctx,
    scale: game.uiScale,
    text: '$900',
    x: game.uiWidth / 2,
    y: game.uiHeight / 2 + 160,
  });
};
