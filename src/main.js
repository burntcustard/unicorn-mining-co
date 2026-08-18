import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, horn, shield, thrusterDualSm } from './modules';
import { checkDocking, flyOut, launch, orbitStation } from './docking';
import { Asteroid } from './asteroid';
import { GameLoop } from 'kontra';
import { Ship } from './ship';
import { Station } from './station';
import { bounceOff } from './bounce';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { game } from './game';
import { place } from './collisions';
import { setSizing } from './set-sizing';
import { ships } from './ships';
import { stations } from './stations';
import { textDemo } from './text-demo';

const ship = new Ship({
  scale: 1,
  shades: colors.white,
  shipData: ships.mustang,
});

ship.fit(shield);

ship.paint(horn, colors.yellow);
ship.paint(thrusterDualSm, colors.violet);
ship.paint(cargoScoop, colors.violet);
ship.paint(shield, colors.violet);

initKeys();

// Only the player's ship is flown off the keyboard. AI pilots switch their own
// modules on and off through the same two methods
bindKeys(['c'], () => ship.toggle(cargoScoop));
bindKeys(['h'], () => ship.toggle(horn));
bindKeys(['s'], () => ship.toggle(shield));

// Space pushes a docked ship back out to the mouth of the bay it came in by
bindKeys([' '], () => ship.dockedTo && launch(ship));

bindKeys(['m'], () => {
  ship.localMovement = ship.localMovement ? null : station;
});

setSizing(game);

window.onresize = () => setSizing(game);

ship.x = game.width / 3;
ship.y = game.height / 2;

centerCamera(game, ship);

const asteroids = Array.from({ length: 2 }, () => new Asteroid({
  dx: Math.random() * 40 - 20,
  dy: Math.random() * 40 - 20,
  fill: colors.black[2],
  radius: 15 + Math.random() * 45,
  spin: Math.random() - 0.5,
  stroke: colors.white[2],
  x: Math.random() * game.width,
  y: Math.random() * game.height,
}));

// Ten points around a small inner radius makes a five pointed star
const stars = Array.from({ length: 2 }, () => new Asteroid({
  dx: Math.random() * 20 - 10,
  dy: Math.random() * 20 - 10,
  fill: colors.yellow[1],
  points: 10,
  radius: 5,
  radiusEven: 2,
  spin: Math.random() - 0.5,
  stroke: colors.yellow[2],
  variance: 0,
  x: Math.random() * game.width,
  y: Math.random() * game.height,
}));

const scenery = [...asteroids, ...stars];

const station = new Station({
  // Turned to face the ship, so its bay is in view from the off
  rotation: Math.PI,
  shades: colors.white,
  stationData: stations.corral,
  x: game.width - 300,
  y: game.height / 2,
});

station.paint(dockingBay, colors.green);

colorsDemo(game);

GameLoop({
  render: () => {
    game.ctx.save();
    game.ctx.translate(-camera.x * game.scale, -camera.y * game.scale);

    station.render(game.scale);
    scenery.forEach((thing) => thing.render(game.scale));
    ship.render(game.scale);
    // Whatever a ship can fly inside of goes on last, over the top of it
    station.render(game.scale, true);

    game.ctx.restore();

    renderDeadzone(game);
    colorsDemo(game);
    textDemo(game);
  },
  update: (dt) => {
    station.update(dt);
    station.hitboxes.forEach(place);
    scenery.forEach((thing) => {
      thing.update(dt);
      place(thing);
    });
    ship.fly(
      flyOut(ship, dt) || keyDown('ArrowUp'),
      (keyDown('ArrowRight') ? 1 : 0) - (keyDown('ArrowLeft') ? 1 : 0),
    );
    ship.update(dt);
    bounceOff(ship);
    checkDocking(ship);
    orbitStation(ship, dt);
    followTarget(game, ship, dt);
  },
}).start();
