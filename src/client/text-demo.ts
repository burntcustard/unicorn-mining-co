import { renderText } from './text';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'E0123456789m',
  ':!$%()*+,-/>',
];

export const textDemo = (game: any) => {
  renderText({
    game,
    text: 'HELLO WORLD',
    x: game.uiWidth / 2,
    y: game.uiHeight / 2 - 150,
    size: 1,
    align: 0,
  });

  charset.forEach((text, i) => {
    renderText({
      game,
      text,
      x: game.uiWidth / 2,
      y: game.uiHeight / 2 - 150 + 40 + i * 20,
      size: 1,
      align: 0,
    });
  });
};
