import { horn, thruster } from './modules';
import { GameLoop } from 'kontra';
import { Ship } from './ship';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { game } from './game';
import { setSizing } from './set-sizing';
import { ships } from './ships';
import { textDemo } from './text-demo';

const ship = new Ship({
  scale: 1,
  shades: colors.white,
  shipData: ships.mustang,
});

ship.paint(horn, colors.yellow);
ship.paint(thruster, colors.violet);

setSizing(game);

window.onresize = () => setSizing(game);

colorsDemo(game);

GameLoop({
  render: () => {
    ship.x = game.width / 2;
    ship.y = game.height / 2 - 100;
    ship.render(game.scale);

    colorsDemo(game);
    textDemo(game);
  },
  update: (dt) => ship.update(dt),
}).start();
