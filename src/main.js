import { Item, remove } from './item';
import { amethyst, diamond, gold, itemTypes, opal } from './items';
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualSm } from './modules';
import { detonate, renderBlasts, updateBlasts } from './explosion';
import { dock, flyOut, launch } from './docking';
import { glows, lights, toggleGlows, toggleLights } from './lighting';
import { grind, mine } from './mining';
import { insidePath, traceBeam } from './prism';
import { player, updatePlayer } from './player';
import { renderBackground, sky } from './background';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { GameLoop } from './game-loop';
// import { Road } from './road';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { contacts } from './collisions';
import { distribute } from './distribute';
import { game } from './game';
import { localMovement } from './local-movement';
import { move } from './vector';
import { renderControls } from './ui/controls';
import { renderCraft } from './craft-render';
import { renderFps } from './fps';
import { renderText } from './text';
import { resolve } from './resolve';
import { scoop } from './scoop';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
import { textDemo } from './text-demo';

// Benchmark-only switches are compiled away from every normal build.
const benchmark = import.meta.env.MODE === 'benchmark' && new URLSearchParams(location.search);

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
// const northRoad = new Road({
//   angle: -Math.PI / 2,
//   distance: corral.radius * 5,
//   x: -200,
//   y: game.height,
// });

const makeAsteroid = (props) => new Asteroid({
  dx: Math.random() * 2 - 1,
  dy: Math.random() * 2 - 1,
  radius: 40 + Math.random() * 100,
  spin: Math.random() * 0.5 - 0.25,
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

if (benchmark && benchmark.has('field')) Object.assign(playerShip, { x: 4500, y: -2000 });

// Plain shapes sat still in a row in front of the ship, so that what the
// floodlight does to them can be checked against something predictable
const blocks = [3, 3, 4, 4, 6].map((points, i) => new Asteroid({
  points,
  radius: 45,
  // Every other one turned a little, to catch a face rather than a corner
  rotation: (i % 2) * 0.6,
  spin: 0,
  // Just enough wander that no two faces come out parallel, because an asteroid
  // with a pair that are is a slab rather than a prism and splits nothing
  variance: 1,
  x: game.width / 3 + 260 + i * 30,
  y: game.height / 2 - 260 + i * 130,
}));

// A few asteroids are salted with cargo, to light up with the floodlight
// and grind open with the horn. The rest stay empty to mine against
blocks[0].bury(new Item({ itemData: diamond }));
blocks[0].bury(new Item({ itemData: gold }));
blocks[2].bury(new Item({ itemData: amethyst }));
// blocks[2].bury(new Item({ itemData: platinum }));
blocks[4].bury(new Item({ itemData: opal }));
asteroids[0].bury(new Item({ itemData: gold }));

const crafts = [playerShip, ...swatches, corral];
// const roads = [northRoad];
const scenery = [...asteroids, ...asteroidField, ...blocks];

if (benchmark) {
  window['testSections'] = () => {
    const five = scenery.find((asteroid) =>
      asteroid.outline.length === 5 && asteroid.health < 240);
    const fiveHealth = five.health;

    five.health /= 2;
    five.crack(five, five.x, five.y);
    const fiveTotal = five.sections.reduce((sum, section) => sum + section.health, 0);

    if (five.sections.length !== 3 || Math.abs(fiveTotal - fiveHealth * 5 / 3) > 1e-9 ||
      five.sections.map((section) => section.triangles.length).sort() + '' !== '1,2,2') {
      throw Error('five');
    }

    const small = five.sections.find((section) => section.triangles.length === 1);

    if (small.maxHealth >= 80) throw Error('small size');
    small.health /= 2;
    small.asteroid.crack(small);
    if (five.sections.length !== 3 || five.detach(small)[0].length !== 1) throw Error('small');
    const asteroid = scenery.find((object) => object.outline.length === 7);
    const originalHealth = asteroid.health;

    asteroid.health /= 2;
    asteroid.crack(asteroid, asteroid.x, asteroid.y);
    if (asteroid.sections.length !== 3 || asteroid.hitboxes().length !== 3) throw Error('root');
    const firstHealth = asteroid.sections.reduce((sum, section) => sum + section.health, 0);

    if (Math.abs(firstHealth - originalHealth * 7 / 3) > 1e-9) throw Error('health');
    const section = asteroid.sections.find((part) => part.triangles.length > 1);
    const sectionHealth = section.maxHealth;
    const otherHealth = firstHealth - sectionHealth;
    const before = asteroid.sections.length;

    section.health /= 2;
    asteroid.crack(section, asteroid.x, asteroid.y);
    if (asteroid.sections.length !== before - 1 + section.triangles.length) throw Error('section');
    const sectionTotal = asteroid.sections.reduce((sum, part) => sum + part.health, 0) - otherHealth;

    if (Math.abs(sectionTotal - sectionHealth * section.triangles.length / 2) > 1e-9) {
      throw Error('section health');
    }

    const leaf = asteroid.sections.find((part) => part.triangles.length === 1);
    const count = asteroid.sections.length;

    leaf.health /= 2;
    asteroid.crack(leaf, asteroid.x, asteroid.y);
    if (asteroid.sections.length !== count) throw Error('triangle attach');
    const [children] = asteroid.detach(leaf);

    if (!children.length || asteroid.sections.includes(leaf)) throw Error('detach');
    const triangle = children[0];

    triangle.health /= 2;
    triangle.crack(triangle, triangle.x, triangle.y);
    if (triangle.sections?.length !== 6) throw Error('triangle split');
    Object.assign(asteroid, { x: playerShip.x, y: playerShip.y });
    const beam = traceBeam(playerShip, lamp, [asteroid]);

    if (beam.outlines.length !== asteroid.sections.length ||
      beam.outlines.some((outline) => !outline.edges)) throw Error('light');
    const splitShip = new Craft({ craftData: shipTypes.mustang, shades: colors.white });

    splitShip.segments[1].health = 0;
    const fragments = splitShip.fracture([]);

    if (fragments.length !== 1 || fragments[0].segments.length !== 1 ||
      !splitShip.cockpit.hull.health || !splitShip.velocity.length() ||
      !fragments[0].velocity.length() || fragments[0].position.distance(splitShip.position) < 1 ||
      Object.getPrototypeOf(fragments[0]) === splitShip) throw Error('ship edge');
    const fragmentSpin = fragments[0].spin;

    fragments[0].update(0.1);
    if (fragments[0].spin !== fragmentSpin) throw Error('fragment spin');
    splitShip.spin = 1;
    splitShip.update(0.1);
    if (splitShip.spin !== 1) throw Error('ship spin');
    fragments[0].update(11);
    if (!fragments[0].dead) throw Error('fragment life');
    const wreck = new Craft({ craftData: shipTypes.mustang, shades: colors.white });
    const cargo = new Item({ itemData: diamond });
    const loose = [];

    wreck.cargo.push(cargo);
    wreck.cockpit.hull.health = 0;
    const wreckage = wreck.fracture(loose);

    if (!wreck.dead || loose[0] !== cargo || cargo.velocity.x !== wreck.velocity.x) {
      throw Error('wreck');
    }

    if (wreckage.length !== 7 || wreckage.some((part) => part.dead || part.velocity.length() < 29)) {
      throw Error('wreck drift');
    }

    return {
      children: children.length,
      firstHealth,
      fragments: fragments.length,
      sections: asteroid.sections.length,
    };
  };
}

// One of everything, in a row below the ship to fly into and scoop up. These
// will come out of mined asteroids rather than being placed
const items = itemTypes.map((itemData, i) => new Item({
  itemData,
  spin: Math.random() - 0.5,
  x: game.width / 3 - 180 + i * 60,
  y: game.height / 2 + 110,
}));

// Everything that can catch hold of a ship and carry it along
const movers = [...crafts];
let physicsOn = 1;

const collide = (objects, targets) => {
  const found = benchmark && benchmark.has('noCollisions') ?
      [] :
      contacts(objects, targets);

  scoop(items, found);
  mine(found);
  dock(crafts, found);
  resolve(found);
};

// Move every physical body and find what it has run into, without any one
// object type owning world collisions
const physics = (dt) => {
  if (!physicsOn || (benchmark && benchmark.has('noPhysics'))) return;

  const otherCrafts = crafts.slice(1);
  const bodies = [...scenery, ...items, ...otherCrafts];
  const nearby = scenery.filter((object) =>
    object.position.distance(playerShip.position) < game.width);
  const step = dt / 4;

  if (!(benchmark && benchmark.has('noMovement'))) {
    bodies.forEach((body) => {
      body.rotation += (body.spin || 0) * dt;
      move(body, dt);
      localMovement(body, movers, dt);
    });
  }

  const world = [
    ...nearby.flatMap((asteroid) => asteroid.hitboxes()),
    ...items,
    ...otherCrafts.flatMap((craft) => craft.hitboxes()),
  ];

  for (let steps = 4; steps--;) {
    if (!(benchmark && benchmark.has('noMovement'))) {
      playerShip.rotation += playerShip.spin * step;
      move(playerShip, step);
      localMovement(playerShip, movers, step);
    }

    const hitboxes = playerShip.hitboxes();

    collide([...world, ...hitboxes], hitboxes);
  }

  collide(world);
};

// The player's lamp, kept to hand so what it is picking out can be worked out
// once a frame rather than hunted for in the segments every time
const lamp = playerShip.segments.find((segment) => segment.module === floodlight);

initKeys();

// The sky is the most expensive thing on screen, so its parts can be stepped
// through one at a time to see which of them is costing what
bindKeys(['6'], sky.cycle);
bindKeys(['7'], toggleLights);
bindKeys(['8'], toggleGlows);
bindKeys(['9'], () => physicsOn = !physicsOn);

// Cutting an item out of an asteroid is what arms it. Until there is mining to do
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
    if (!(benchmark && benchmark.has('noBackground'))) renderBackground(game);

    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);

    // roads.forEach((road) => road.render());
    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them, using the same z-index as ship modules
    for (let zIndex = -3; zIndex < 4; zIndex++) {
      if (zIndex === -2) {
        scenery.forEach((object) => object.render());

        // Buried cargo shows only through the asteroid slice the floodlight is
        // crossing, as if the lamp lets a pilot peer inside it
        if (lights && lamp.anim > 0.5) {
          const beam = traceBeam(playerShip, lamp, scenery);
          const worldFrame = game.ctx.getTransform();

          game.ctx.save();
          game.ctx.translate(playerShip.x, playerShip.y);
          game.ctx.rotate(playerShip.rotation);
          game.ctx.translate(lamp.x, lamp.y);
          game.ctx.clip(insidePath(beam));
          game.ctx.setTransform(worldFrame);

          scenery.forEach((asteroid) => {
            if (asteroid.contents) asteroid.contents.forEach((item) => item.render());
          });

          game.ctx.restore();
        }

        items.forEach((item) => item.render());
      }

      crafts.forEach((craft) => renderCraft(craft, scenery, zIndex));
    }

    // Sparks off the horn sit over the asteroids and ships they come off
    renderSparks(game);
    // Light rather than paint, so it goes over everything it lights up
    if (lights) renderBlasts(game);

    game.ctx.restore();

    renderDeadzone(game);
    renderFps(game);
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `$${player.credits}`, x: 10, y: 30 });
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `6 ${sky.label}`, x: 10, y: 50 });
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `7 LIGHTING: ${lights ? 'ON' : 'OFF'}`, x: 10, y: 70 });
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `8 GLOWS: ${glows ? 'ON' : 'OFF'}`, x: 10, y: 90 });
    renderText({ ctx: game.ctx, scale: game.uiScale, text: `9 PHYSICS: ${physicsOn ? 'ON' : 'OFF'}`, x: 10, y: 110 });
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
    // roads.forEach((road) => road.update(dt));

    // Backwards, because an item that goes off takes itself out of the list
    for (let i = items.length; i--;) {
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
    [...scenery.flatMap((asteroid) => asteroid.sections || asteroid),
      ...items, ...crafts.flatMap((craft) => craft.segments)]
      .forEach((target) => grind(target, dt, scenery, items));
    crafts.push(...crafts.flatMap((craft) => craft.fracture(items)));

    for (let i = crafts.length; i-- > 1;) {
      if (crafts[i].dead) crafts.splice(i, 1);
    }

    followTarget(game, playerShip, dt);
  },
}).start();
