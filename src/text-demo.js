import { renderText } from './text';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'E0123456789m',
  ':!$%()*+,-/>',
];

export const textDemo = (game) => {
  renderText(game, 'HELLO WORLD', game.uiWidth / 2, game.uiHeight / 2 - 150, 1, '#fff', 1);

  charset.forEach((text, i) => {
    renderText(game, text, game.uiWidth / 2, game.uiHeight / 2 - 150 + 40 + i * 20, 1, '#fff', 1);
  });
};
