import { Item, remove } from './item';
import { amethyst, diamond, gold, itemTypes, opal, platinum } from './items';
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualSm } from './modules';
import { detonate, renderBlasts, updateBlasts } from './explosion';
import { dock, flyOut, launch } from './docking';
import { grind, mine } from './mining';
import { insidePath, traceBeam } from './prism';
import { maxHop, move } from './vector';
import { player, updatePlayer } from './player';
import { renderBackground, sky } from './background';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { GameLoop } from 'kontra';
import { Road } from './road';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { contacts } from './collisions';
import { distribute } from './distribute';
import { game } from './game';
import { localMovement } from './local-movement';
import { renderControls } from './ui/controls';
import { renderFps } from './fps';
import { renderText } from './text';
import { resolve } from './resolve';
import { scoop } from './scoop';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
import { textDemo } from './text-demo';

setSizing(game);

window.onresize = () => setSizing(game);

const playerShip = new Craft({
  craftData: shipTypes.mustang,
  shades: colors.white,
  x: game.width / 3,
  y: game.height / 2,
});

[thrusterDualSm, cargoScoop, cargoScoop, horn, shield, floodlight]
  .forEach((module) => playerShip.fit(module));

playerShip.paint(horn, colors.yellow);
playerShip.paint(thrusterDualSm, colors.violet);
playerShip.paint(cargoScoop, colors.violet);
playerShip.paint(shield, colors.violet);

// One hull of every colour, lined up to see how the light falls across them
const swatches = [
  colors.black,
  colors.red,
  colors.orange,
  colors.yellow,
  colors.green,
  colors.cyan,
  colors.violet,
  colors.black,
  colors.white,
].map((shades, i) => new Craft({
  craftData: shipTypes.mustang,
  shades,
  x: 120 + i * 120,
  y: game.height - 120,
}));

const corral = new Craft({
  craftData: stationTypes.corral,
  // Turned to face the ship, so its bay is in view from the off
  rotation: Math.PI,
  shades: colors.white,
  x: game.width,
  y: game.height / 2,
});

corral.fit(dockingBay);
corral.paint(dockingBay, colors.green);

// Off the left edge of where the game starts, running a long way upwards
const northRoad = new Road({
  angle: -Math.PI / 2,
  distance: corral.radius * 5,
  x: -200,
  y: game.height,
});

const makeAsteroid = (props) => new Asteroid({
  dx: Math.random() * 2 - 1,
  dy: Math.random() * 2 - 1,
  fill: colors.black[2],
  radius: 40 + Math.random() * 100,
  spin: Math.random() * 0.5 - 0.25,
  stroke: colors.white[2],
  ...props,
});

const asteroids = Array.from({ length: 2 }, () => makeAsteroid({
  x: Math.random() * game.width,
  y: Math.random() * game.height,
}));

// Build the exact field population first, including its cargo, then spread the
// finished instances through an oval above the starting area
const fieldAsteroids = Array.from({ length: 200 }, () => makeAsteroid());

fieldAsteroids.forEach((asteroid, i) => {
  if (!(i % 5)) {
    for (let cargo = Math.floor(asteroid.radius / 30); cargo > 0; cargo--) {
      asteroid.bury(new Item({
        itemData: itemTypes[Math.floor(Math.random() * itemTypes.length)],
      }));
    }
  }
});

const asteroidField = distribute(fieldAsteroids, {
  density: 0,
  height: 2000,
  width: 10000,
  x: 4500,
  y: -2000,
});

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

const crafts = [playerShip, ...swatches, corral];
const roads = [northRoad];
const scenery = [...asteroids, ...asteroidField, ...blocks];

// One of everything, in a row below the ship to fly into and scoop up. These
// will come out of mined rocks rather than being placed
const items = itemTypes.map((itemData, i) => new Item({
  itemData,
  spin: Math.random() - 0.5,
  x: game.width / 3 - 180 + i * 60,
  y: game.height / 2 + 110,
}));

// Everything that can catch hold of a ship and carry it along
const movers = [...crafts, ...roads];

// Move every physical body through the same short steps, so fast things cannot
// jump through thin colliders and no one object type owns world collisions
const physics = (dt) => {
  let left = dt;

  while (left > 0) {
    const bodies = [...scenery, ...items, ...crafts];
    const colliders = [
      ...scenery,
      ...items,
      ...crafts.flatMap((craft) => craft.hitboxes()),
    ];
    const speed = Math.max(
      ...bodies.map((body) => body.velocity.length()),
      ...colliders.map((collider) => {
        const body = collider.owner || collider;

        return Math.abs(body.spin || 0) *
          (body.position.distance(collider) + collider.radius);
      }),
      ...movers.map((mover) => mover.maxSpeed),
    );
    const step = Math.min(left, maxHop / speed);

    bodies.forEach((body) => {
      body.rotation += (body.spin || 0) * step;
      move(body, step);
      localMovement(body, movers, step);
    });
    const found = contacts([
      ...scenery,
      ...items,
      ...crafts.flatMap((craft) => craft.hitboxes()),
    ]);

    scoop(items, found);
    mine(found);
    dock(crafts, found);
    resolve(found);
    left -= step;
  }
};

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

centerCamera(game, playerShip);
colorsDemo(game);

GameLoop({
  render: () => {
    // The sky slides past at its own pace, so it moves itself
    renderBackground(game);

    game.ctx.save();
    game.ctx.translate(-camera.x * game.scale, -camera.y * game.scale);

    roads.forEach((road) => road.render(game.scale));
    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them, using the same z-index as ship modules
    for (let zIndex = -3; zIndex < 4; zIndex++) {
      if (zIndex === -2) {
        scenery.forEach((object) => object.render(game.scale));
        // Buried cargo shows only through the slice of rock the floodlight is
        // crossing, as if the lamp lets a pilot peer inside it
        if (lamp.anim > 0.5) {
          const beam = traceBeam(playerShip, lamp, scenery);
          const worldFrame = game.ctx.getTransform();

          game.ctx.save();
          game.ctx.scale(game.scale, game.scale);
          game.ctx.translate(playerShip.x, playerShip.y);
          game.ctx.rotate(playerShip.rotation);
          game.ctx.translate(lamp.x, lamp.y);
          game.ctx.clip(insidePath(beam));
          game.ctx.setTransform(worldFrame);

          scenery.forEach((rock) => {
            if (rock.contents) rock.contents.forEach((item) => item.render(game.scale));
          });

          game.ctx.restore();
        }
        items.forEach((item) => item.render(game.scale));
      }
      crafts.forEach((craft) => craft.render(game.scale, scenery, zIndex));
    }
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
    roads.forEach((road) => road.update(dt));

    // Backwards, because an item that goes off takes itself out of the list
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];

      item.update(dt);

      // A fuse only ever reaches zero once it has been armed
      if (item.fuse === 0) {
        remove(item, items);
        detonate(item, items, crafts);
      }
    }

    updateBlasts(dt);
    updateSparks(dt);
    updatePlayer(dt);

    // An AI pilot will set its own ship's controls here. Whoever is aboard, a
    // launching ship sees itself out of the bay, and a ship on a road has the
    // road doing the driving for it
    const thrusting = !playerShip.localMovementParent?.drives &&
      (flyOut(playerShip, dt) || keyDown('ArrowUp'));

    playerShip.fly(
      thrusting ? 1 : 0,
      (keyDown('ArrowRight') ? 1 : 0) - (keyDown('ArrowLeft') ? 1 : 0),
    );

    crafts.forEach((craft) => craft.update(dt));
    physics(dt);
    scenery.forEach((object) => object.update(dt));

    // Apply horn damage once per update, however many physics substeps found it
    [...scenery, ...items, ...crafts.flatMap((craft) => craft.segments)]
      .forEach((target) => grind(target, dt, scenery, items));

    followTarget(game, playerShip, dt);
  },
}).start();
