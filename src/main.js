import { horn, thruster } from './modules';
import { GameLoop } from 'kontra';
import { Ship } from './ship';
import { colors } from './colors';
import { demoColors } from './demo-colors';
import { game } from './game';
import { renderText } from './text';
import { setSizing } from './set-sizing';
import { ships } from './ships';

const charset = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  '0123456789',
  '!%(),-/>',
];

const ship = new Ship({
  scale: 1,
  shades: colors.white,
  shipData: ships.mustang,
});

ship.paint(horn, colors.yellow);
ship.paint(thruster, colors.violet);

setSizing(game);

window.onresize = () => setSizing(game);

demoColors(game);

GameLoop({
  render: () => {
    ship.x = game.width / 2;
    ship.y = game.height / 2 - 100;
    ship.render(game.scale);

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

    demoColors(game);
  },
  update: (dt) => ship.update(dt),
}).start();
