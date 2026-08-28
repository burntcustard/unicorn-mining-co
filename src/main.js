import { Item, remove } from './item';
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget, renderDeadzone } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualMd } from './modules';
import { detonate, renderBlasts, updateBlasts } from './explosion';
import {
  // amethyst,
  diamond,
  gold,
  itemTypes,
  // opal
} from './items';
import { dock, flyOut } from './docking';
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
import { back, confirmSelection, moveSelection, renderDocked } from './ui/docked';
import { renderFps } from './fps';
import { renderIndicators } from './ui/indicators';
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

[thrusterDualMd, cargoScoop, cargoScoop, horn, shield, floodlight]
  .forEach((module) => playerShip.fit(module));
player.modules = playerShip.slots.map(({ module }) => module);

playerShip.paint(horn, colors.yellow);
playerShip.paint(thrusterDualMd, colors.violet);
playerShip.paint(cargoScoop, colors.violet);
playerShip.paint(shield, colors.violet);

// Debug/demo examples of game objects
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
  y: game.height - 100,
}));
// End of debug/demo examples of game objects

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
  radius: 50 + Math.random() * 100,
  spin: (Math.round(Math.random()) - 0.5) * (1 + Math.random()) / 20,
  ...props,
});

const asteroids = Array.from({ length: 2 }, () => makeAsteroid({
  x: Math.random() * game.width / 2,
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
// const blocks = [3, 3, 4, 4, 6].map((points, i) => new Asteroid({
//   points,
//   radius: 45,
//   // Every other one turned a little, to catch a face rather than a corner
//   rotation: (i % 2) * 0.6,
//   spin: 0,
//   // Just enough wander that no two faces come out parallel, because an asteroid
//   // with a pair that are is a slab rather than a prism and splits nothing
//   variance: 1,
//   x: game.width / 3 + 260 + i * 30,
//   y: game.height / 2 - 260 + i * 130,
// }));

// A few asteroids are salted with cargo, to light up with the floodlight
// and grind open with the horn. The rest stay empty to mine against
// blocks[0].bury(new Item({ itemData: diamond }));
// blocks[0].bury(new Item({ itemData: gold }));
// blocks[2].bury(new Item({ itemData: amethyst }));
// blocks[2].bury(new Item({ itemData: platinum }));
// blocks[4].bury(new Item({ itemData: opal }));
// asteroids[0].bury(new Item({ itemData: gold }));

const crafts = [playerShip, ...swatches, corral];
// const roads = [northRoad];
const scenery = [
  ...asteroids,
  ...asteroidField,
  // ...blocks
];

if (benchmark) {
  window['testSections'] = () => {
    const five = scenery.find((asteroid) =>
      asteroid.outline.length === 5 && asteroid.health < 240);
    const triangle = new Asteroid({ points: 3, radius: 90 });

    if (triangle.sections.length !== 4 ||
      five.sections.length !== five.outline.length * 4 ||
      five.hitboxes().length !== 1 ||
      five.sections.some((section) => section.asteroid !== five)) {
      throw Error('five');
    }

    const asteroid = scenery.find((object) => object.outline.length === 7);
    const leaf = asteroid.sections[0];
    const count = asteroid.sections.length;
    const velocity = asteroid.velocity;

    asteroid.spin = 0;
    leaf.health /= 2;
    const [children] = asteroid.detach(leaf);
    const [piece, remainder] = children;

    scenery.splice(scenery.indexOf(asteroid), 1, ...children);

    if (children.length !== 2 || asteroid.sections.length || remainder.sections.includes(leaf)) {
      throw Error('detach');
    }

    if (remainder.sections.length !== count - 1 || !piece.life) {
      throw Error('leaf');
    }

    const pieceSpeed = piece.velocity.subtract(velocity).length();
    const remainderSpeed = remainder.velocity.subtract(velocity).length();

    if (pieceSpeed <= remainderSpeed ||
      Math.abs(pieceSpeed * piece.mass - remainderSpeed * remainder.mass) > 1e-9) {
      throw Error('leaf force');
    }

    Object.assign(remainder, { x: playerShip.x, y: playerShip.y });
    const beam = traceBeam(playerShip, lamp, [remainder]);

    if (beam.outlines.length !== remainder.sections.length ||
      beam.outlines.some((outline) => !outline.edges)) throw Error('light');
    const cargoRock = new Asteroid({ points: 5, radius: 90 });
    const cargoItem = new Item({ itemData: diamond });
    const otherCargo = new Item({ itemData: gold });

    cargoRock.bury(cargoItem);
    cargoRock.bury(otherCargo);

    if (cargoRock.contents.length !== 2 ||
      Math.hypot(cargoItem.buried.x - otherCargo.buried.x,
        cargoItem.buried.y - otherCargo.buried.y) < cargoRock.radius / 3) {
      throw Error('cargo placement');
    }

    const oversized = new Item({ itemData: gold });

    oversized.radius = cargoRock.radius;
    cargoRock.bury(oversized);

    if (!cargoRock.contents.includes(oversized) ||
      !cargoRock.sections.some((section) => section.contents.includes(oversized))) {
      throw Error('cargo snap');
    }

    const [cargoParts, early] = cargoRock.detach(
      cargoRock.sections.find((section) => !section.contents.length),
    );
    const cargoPart = cargoParts.find((part) =>
      part.sections?.some((section) => section.contents.includes(cargoItem)));

    if (early.length || !cargoPart) throw Error('cargo early');
    const [cargoDebris, released] = cargoPart.detach(
      cargoPart.sections.find((section) => section.contents.includes(cargoItem)),
    );

    const debris = cargoDebris.find((part) => part.contents.includes(cargoItem));
    const expired = [];

    debris.update(11, expired);

    if (released.length || debris.dead || expired.length) throw Error('cargo expiry');

    const [spent, mined] = debris.split();

    if (spent.length || mined[0] !== cargoItem) throw Error('cargo mining');

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
      leafHealth: leaf.maxHealth,
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

// Debug toggles
let showDeadzone = false;
let showMass = false;
let showTextDemo = false;
let showColorsDemo = false;
// End of debug toggles

const collide = (objects, targets) => {
  const found = benchmark && benchmark.has('noCollisions') ?
      [] :
      contacts(objects, targets);

  scoop(items, found);
  mine(found);
  if (targets) dock(found.filter(({ other }) => other.dockSegment));
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

// Debug key bindings
bindKeys(['2'], () => showColorsDemo = !showColorsDemo);
bindKeys(['3'], () => showTextDemo = !showTextDemo);
bindKeys(['4'], () => showDeadzone = !showDeadzone);
bindKeys(['5'], () => showMass = !showMass);
bindKeys(['6'], sky.cycle);
bindKeys(['7'], toggleLights);
bindKeys(['8'], toggleGlows);
bindKeys(['9'], () => physicsOn = !physicsOn);
// End of debug key bindings

// Only the player's ship is flown off the keyboard. AI pilots work their own
// modules through the same methods. Each switchable module names the key that
// works it, so the panel and the binding stay in step off the one letter
[cargoScoop, horn, shield, floodlight].forEach((module) =>
  bindKeys([module.key], () => playerShip.toggle(module)));

// Left steps back through the panel without undocking; Escape also launches
// once there are no more columns to step out of
bindKeys(['ArrowLeft'], () => playerShip.dockedTo && back());
bindKeys(['Escape'], () => playerShip.dockedTo && back(playerShip));

// Space or the right arrow drill into whichever column of the docked panel is open
[' ', 'ArrowRight'].forEach((key) =>
  bindKeys([key], () => playerShip.dockedTo && confirmSelection(playerShip)));

// Up and down move whichever of the docked panel's columns is open
bindKeys(['ArrowUp'], () => playerShip.dockedTo && moveSelection(-1, playerShip));
bindKeys(['ArrowDown'], () => playerShip.dockedTo && moveSelection(1, playerShip));

centerCamera(game, playerShip);

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
        scenery.forEach((object) => {
          object.render();
          // A loose leaf cannot be mined any smaller, so its cargo stays in view.
          object.sections || object.contents.forEach((item) => item.render());
        });

        // Cargo still inside mineable asteroids shows only through the slice
        // the floodlight is crossing, as if the lamp lets a pilot peer inside
        if (lights && lamp.anim > 0.5) {
          const beam = traceBeam(playerShip, lamp, scenery);
          const worldFrame = game.ctx.getTransform();

          game.ctx.save();
          game.ctx.translate(playerShip.x, playerShip.y);
          game.ctx.rotate(playerShip.rotation);
          game.ctx.translate(lamp.x, lamp.y);
          game.ctx.clip(insidePath(beam));
          game.ctx.setTransform(worldFrame);

          scenery.forEach((asteroid) =>
            asteroid.sections && asteroid.contents.forEach((item) => item.render()));

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


    // This is debug UI
    if (showDeadzone) renderDeadzone(game);
    renderFps(game);
    renderText({ game, text: `2 COLORS-DEMO:${showColorsDemo ? 'ON' : 'OFF'}`, x: 10, y: 90 });
    renderText({ game, text: `3 TEXT-DEMO:${showTextDemo ? 'ON' : 'OFF'}`, x: 10, y: 110 });
    renderText({ game, text: `4 DEADZONE:${showDeadzone ? 'ON' : 'OFF'}`, x: 10, y: 130 });
    renderText({ game, text: `5 MASS-VALUES:${showMass ? 'ON' : 'OFF'}`, x: 10, y: 150 });
    renderText({ game, text: `6 SKY:${sky.label}`, x: 10, y: 170 });
    renderText({ game, text: `7 LIGHTING:${lights ? 'ON' : 'OFF'}`, x: 10, y: 190 });
    renderText({ game, text: `8 GLOWS:${glows ? 'ON' : 'OFF'}`, x: 10, y: 210 });
    renderText({ game, text: `9 PHYSICS:${physicsOn ? 'ON' : 'OFF'}`, x: 10, y: 230 });

    if (showMass) {
      game.ctx.save();
      game.ctx.fillStyle = colors.white[2];
      game.ctx.font = '12px monospace';
      game.ctx.textAlign = 'center';
      game.ctx.textBaseline = 'middle';
      [...scenery, ...crafts].forEach(({ mass, x, y }) => {
        if (mass) game.ctx.fillText(Math.round(mass), x, y);
      });
      game.ctx.restore();
    }
    // End of debug UI

    renderIndicators(game, [corral], colors.green[2], 10000);
    renderControls(game, playerShip);
    if (playerShip.dockedTo) renderDocked(game, playerShip);

    renderText({ game, text: `${Math.round(playerShip.x)}/${Math.round(playerShip.y)}`, x: 20, y: 20 });
    renderText({ game, text: `$${player.credits}`, x: 10, y: 50 });

    if (player.noteFor) {
      renderText({
        alignCenter: true,
        game,
        text: player.note,
        x: game.uiWidth / 2,
        y: game.uiHeight - 40,
      });
    }

    if (showColorsDemo) colorsDemo(game);
    if (showTextDemo) textDemo(game);
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
    scenery.forEach((object, i) => (object.update(dt, items), object.dead && scenery.splice(i, 1)));

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
