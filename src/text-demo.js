import { renderText } from './text';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  '0123456789',
  ':!$%(),-/>',
];

export const textDemo = (game) => {
  renderText({
    alignCenter: true,
    game,
    text: 'Hello world',
    x: game.uiWidth / 2,
    y: game.uiHeight / 2 - 150,
  });

  charset.forEach((text, i) => {
    renderText({
      alignCenter: true,
      game,
      text,
      x: game.uiWidth / 2,
      y: game.uiHeight / 2 - 150 + 40 + i * 20,
    });
  });
};
