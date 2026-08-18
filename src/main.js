import { Item, remove } from './item';
import { amethyst, diamond, gold, itemTypes, opal, platinum } from './items';
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualSm } from './modules';
import { detonate, renderBlasts, updateBlasts } from './explosion';
import { flyOut, launch } from './docking';
import { insidePath, traceBeam } from './prism';
import { player, updatePlayer } from './player';
import { renderBackground, sky } from './background';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { GameLoop } from 'kontra';
import { Road } from './road';
import { Ship } from './ship';
import { Station } from './station';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { game } from './game';
import { grind } from './mining';
import { place } from './collisions';
import { release } from './movement';
import { renderControls } from './ui/controls';
import { renderFps } from './fps';
import { renderText } from './text';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
import { textDemo } from './text-demo';

setSizing(game);

window.onresize = () => setSizing(game);

const playerShip = new Ship({
  scale: 1,
  shades: colors.white,
  shipData: shipTypes.mustang,
  x: game.width / 3,
  y: game.height / 2,
});

playerShip.fit(shield);
playerShip.fit(floodlight);

playerShip.paint(horn, colors.yellow);
playerShip.paint(thrusterDualSm, colors.violet);
playerShip.paint(cargoScoop, colors.violet);
playerShip.paint(shield, colors.violet);

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
  x: game.width,
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

// Plain shapes sat still in a row in front of the ship, so that what the
// floodlight does to them can be checked against something predictable
const blocks = [3, 3, 4, 4, 6].map((points, i) => new Asteroid({
  fill: colors.black[2],
  points,
  radius: 45,
  // Every other one turned a little, to catch a face rather than a corner
  rotation: (i % 2) * 0.6,
  spin: 0,
  stroke: colors.white[2],
  // Just enough wander that no two faces come out parallel, because a rock
  // with a pair that are is a slab rather than a prism and splits nothing
  variance: 1,
  x: game.width / 3 + 260 + i * 30,
  y: game.height / 2 - 260 + i * 130,
}));

// A few of the rocks are salted with cargo, to light up with the floodlight
// and grind open with the horn. The rest stay empty to mine against
blocks[0].bury(new Item({ itemData: diamond }));
blocks[0].bury(new Item({ itemData: gold }));
blocks[2].bury(new Item({ itemData: amethyst }));
blocks[2].bury(new Item({ itemData: platinum }));
blocks[4].bury(new Item({ itemData: opal }));
asteroids[0].bury(new Item({ itemData: gold }));

const fleet = [playerShip, ...swatches];
const roads = [northRoad];
const scenery = [...asteroids, ...blocks, ...stars];
const stations = [corral];

// One of everything, in a row below the ship to fly into and scoop up. These
// will come out of mined rocks rather than being placed
const items = itemTypes.map((itemData, i) => new Item({
  itemData,
  spin: Math.random() - 0.5,
  x: game.width / 3 - 180 + i * 60,
  y: game.height / 2 + 110,
}));

// Everything that can catch hold of a ship and carry it along
const movers = [...stations, ...roads];

// The player's lamp, kept to hand so what it is picking out can be worked out
// once a frame rather than hunted for in the segments every time
const lamp = playerShip.segments.find((segment) => segment.module === floodlight);

initKeys();

// The sky is the most expensive thing on screen, so its parts can be stepped
// through one at a time to see which of them is costing what
bindKeys(['b'], sky.cycle);

// Cutting an item out of a rock is what arms it. Until there is mining to do
// that, this stands in for it
bindKeys(['x'], () => items.forEach((item) => item.arm()));

// Only the player's ship is flown off the keyboard. AI pilots work their own
// modules through the same methods. Each switchable module names the key that
// works it, so the panel and the binding stay in step off the one letter
[cargoScoop, horn, shield, floodlight].forEach((module) =>
  bindKeys([module.key], () => playerShip.toggle(module)));

// Space sees a docked ship back out through the bay it came in by
bindKeys([' '], () => playerShip.dockedTo && launch(playerShip));

bindKeys(['m'], () => {
  if (playerShip.localMovement) release(playerShip);
  else playerShip.localMovement = corral;
});

centerCamera(game, playerShip);
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
    // Buried cargo shows only through the slice of rock the floodlight is
    // actually crossing, as if the lamp lets a pilot peer inside it. The reveal
    // is clipped to the shape the beam makes inside the rocks, taken in the
    // lamp's frame the way the beam is, then the world frame is put back with
    // that clip still holding so the items draw where they really are, over the
    // top of every rock
    if (lamp.anim > 0.5) {
      const beam = traceBeam(playerShip, lamp, scenery);
      const worldFrame = game.ctx.getTransform();

      game.ctx.save();
      game.ctx.scale(game.scale, game.scale);
      game.ctx.translate(playerShip.x, playerShip.y);
      game.ctx.rotate(playerShip.rotation);
      game.ctx.scale(playerShip.scale, playerShip.scale);
      game.ctx.translate(lamp.x, lamp.y);
      game.ctx.clip(insidePath(beam));
      game.ctx.setTransform(worldFrame);

      scenery.forEach((rock) => {
        if (rock.contents) rock.contents.forEach((item) => item.render(game.scale));
      });

      game.ctx.restore();
    }
    items.forEach((item) => item.render(game.scale));
    fleet.forEach((ship) => ship.render(game.scale, scenery));
    // Whatever a ship can fly inside of goes on last, over the top of it
    stations.forEach((station) => station.render(game.scale, true));
    // Sparks off the horn sit over the rocks and ships they come off
    renderSparks(game, game.scale);
    // Light rather than paint, so it goes over everything it lights up
    renderBlasts(game, game.scale);

    game.ctx.restore();

    renderDeadzone(game);
    renderFps(game);
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `$${player.credits}`, x: 10, y: 30 });
    renderText({ ctx: game.ctx, scale: game.uiScale, text: sky.label, x: 10, y: 50 });
    renderControls(game, playerShip);

    if (player.noteFor) {
      renderText({
        alignCenter: true,
        ctx: game.ctx,
        scale: game.uiScale,
        text: player.note,
        x: game.uiWidth / 2,
        y: game.uiHeight - 40,
      });
    }

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

    // Backwards, because an item that goes off takes itself out of the list
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];

      item.update(dt);
      place(item);

      // A fuse only ever reaches zero once it has been armed
      if (item.fuse === 0) {
        remove(item, items);
        detonate(item, items, fleet);
      }
    }

    updateBlasts(dt);
    updateSparks(dt);
    updatePlayer(dt);

    // An AI pilot will set its own ship's controls here. Whoever is aboard, a
    // launching ship sees itself out of the bay, and a ship on a road has the
    // road doing the driving for it
    const thrusting = !playerShip.localMovement?.drives &&
      (flyOut(playerShip, dt) || keyDown('ArrowUp'));

    playerShip.fly(
      thrusting ? 1 : 0,
      (keyDown('ArrowRight') ? 1 : 0) - (keyDown('ArrowLeft') ? 1 : 0),
    );

    fleet.forEach((ship) => ship.update(dt, items, movers));

    // Rocks an active horn has been leaning on for long enough crack open,
    // spilling whatever was buried in them out to be scooped up. Backwards,
    // because a rock that breaks takes itself out of the scenery
    for (let i = scenery.length - 1; i >= 0; i--) {
      grind(scenery[i], dt, scenery, items);
    }

    followTarget(game, playerShip, dt);
  },
}).start();
