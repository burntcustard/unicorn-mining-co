import { game } from './game';
import { renderText } from './text';
import { setSizing } from './set-sizing';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  '0123456789',
  '!%(),-/>',
];

const render = () => {
  setSizing(game);

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

render();

window.onresize = render;
