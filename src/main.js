import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, horn, shield, thrusterDualSm } from './modules';
import { carry, release } from './movement';
import { checkDocking, flyOut, launch } from './docking';
import { Asteroid } from './asteroid';
import { GameLoop } from 'kontra';
import { Road } from './road';
import { Ship } from './ship';
import { Station } from './station';
import { bounceOff } from './bounce';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { game } from './game';
import { place } from './collisions';
import { renderBackground } from './background';
import { renderFps } from './fps';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
import { textDemo } from './text-demo';

setSizing(game);

window.onresize = () => setSizing(game);

const player = new Ship({
  scale: 1,
  shades: colors.white,
  shipData: shipTypes.mustang,
  x: game.width / 3,
  y: game.height / 2,
});

player.fit(shield);

player.paint(horn, colors.yellow);
player.paint(thrusterDualSm, colors.violet);
player.paint(cargoScoop, colors.violet);
player.paint(shield, colors.violet);

// One hull of every colour, lined up to see how the light falls across them
const swatches = ['black', 'red', 'orange', 'yellow', 'green', 'cyan', 'violet', 'black', 'white']
  .map((color, i) => new Ship({
    scale: 1,
    shades: colors[color],
    shipData: shipTypes.mustang,
    x: 120 + i * 120,
    y: game.height - 120,
  }));

const corral = new Station({
  // Turned to face the ship, so its bay is in view from the off
  rotation: Math.PI,
  shades: colors.white,
  stationData: stationTypes.corral,
  x: game.width - 300,
  y: game.height / 2,
});

corral.paint(dockingBay, colors.green);

// Off the left edge of where the game starts, running a long way upwards
const northRoad = new Road({
  angle: -Math.PI / 2,
  distance: corral.radius * 5,
  x: -200,
  y: game.height,
});

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

const fleet = [player, ...swatches];
const roads = [northRoad];
const scenery = [...asteroids, ...stars];
const stations = [corral];

// Everything that can catch hold of a ship and carry it along
const movers = [...stations, ...roads];

initKeys();

// Only the player's ship is flown off the keyboard. AI pilots work their own
// modules through the same methods
bindKeys(['c'], () => player.toggle(cargoScoop));
bindKeys(['h'], () => player.toggle(horn));
bindKeys(['s'], () => player.toggle(shield));

// Space sees a docked ship back out through the bay it came in by
bindKeys([' '], () => player.dockedTo && launch(player));

bindKeys(['m'], () => {
  if (player.localMovement) release(player);
  else player.localMovement = corral;
});

centerCamera(game, player);
colorsDemo(game);

GameLoop({
  render: () => {
    // The sky slides past at its own pace, so it moves itself
    renderBackground(game);

    game.ctx.save();
    game.ctx.translate(-camera.x * game.scale, -camera.y * game.scale);

    roads.forEach((road) => road.render(game.scale));
    stations.forEach((station) => station.render(game.scale));
    scenery.forEach((thing) => thing.render(game.scale));
    fleet.forEach((ship) => ship.render(game.scale));
    // Whatever a ship can fly inside of goes on last, over the top of it
    stations.forEach((station) => station.render(game.scale, true));

    game.ctx.restore();

    renderDeadzone(game);
    renderFps(game);
    colorsDemo(game);
    textDemo(game);
  },
  update: (dt) => {
    stations.forEach((station) => {
      station.update(dt);
      station.hitboxes.forEach(place);
    });
    roads.forEach((road) => road.update(dt));
    scenery.forEach((thing) => {
      thing.update(dt);
      place(thing);
    });

    // An AI pilot will set its own ship's controls here. Whoever is aboard, a
    // launching ship sees itself out of the bay, and a ship on a road has the
    // road doing the driving for it
    const thrusting = !player.localMovement?.drives &&
      (flyOut(player, dt) || keyDown('ArrowUp'));

    player.fly(
      thrusting ? 1 : 0,
      (keyDown('ArrowRight') ? 1 : 0) - (keyDown('ArrowLeft') ? 1 : 0),
    );

    fleet.forEach((ship) => {
      ship.update(dt);
      bounceOff(ship);
      checkDocking(ship);
      carry(ship, movers, dt);
    });

    followTarget(game, player, dt);
  },
}).start();
