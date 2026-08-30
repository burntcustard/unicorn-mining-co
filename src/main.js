import { Item, remove } from './item';
import { amethyst, itemTypes } from './items';
import { back, confirmSelection, moveSelection, renderDocked } from './ui/docked';
// @ifdef DEBUG
import { bindDebug, debugCrafts, lights, physicsOn, renderDebug, renderDebugDemos } from './debug';
// @endif
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualMd } from './modules';
import { detonate, renderBlasts, updateBlasts } from './explosion';
import { dock, flyOut } from './docking';
import { grind, mine } from './mining';
import { insidePath, traceBeam } from './prism';
import { player, updatePlayer } from './player';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { GameLoop } from './game-loop';
// import { Road } from './road';
import { benchmarkFlag } from './benchmark';
import { colors } from './colors';
import { contacts } from './collisions';
import { game } from './game';
import { generateWorld } from './world';
import { localMovement } from './local-movement';
import { move } from './vector';
import { renderBackground } from './background';
import { renderControls } from './ui/controls';
import { renderCraft } from './craft-render';
import { renderIndicators } from './ui/indicators';
import { renderText } from './text';
import { resolve } from './resolve';
import { scoop } from './scoop';
import { setSizing } from './set-sizing';
import { shipTypes } from './ships';
import { stationTypes } from './stations';
// @ifdef BENCHMARK
import { testSections } from './section-test';
// @endif

setSizing(game);

window.onresize = () => setSizing(game);

const playerShip = new Craft({
  craftData: shipTypes.mustang,
  shades: colors.white,
  x: 0,
  y: 0,
});

horn.shades = colors.yellow;
thrusterDualMd.shades = cargoScoop.shades = shield.shades = colors.violet;
[thrusterDualMd, cargoScoop, cargoScoop, horn, shield, floodlight]
  .forEach((module) => {
    playerShip.fit(module);
    module.owned = (module.owned || 0) + 1;
  });

dockingBay.shades = colors.green;
const world = generateWorld(13312);
const stations = world.stations.map((properties) => {
  const station = new Craft({ ...properties, craftData: stationTypes.corral, shades: colors.white });

  station.fit(dockingBay);

  return station;
});
const wrecks = world.wrecks.map((properties) => new Craft({
  ...properties,
  craftData: shipTypes.mustang,
  shades: colors.orange,
}));
const worldObjects = [
  ...stations.map((instance) => instance.worldObject = { instance }),
  ...wrecks.map((instance) => instance.worldObject = { instance }),
  ...world.fields.flatMap(({ asteroids }) => asteroids)
    .map((properties) => Object.assign(properties, { scenery: true })),
];
const activeWorldObjects = [];
const scenery = [];
const localCrafts = [
  playerShip,
  // @ifdef DEBUG
  ...debugCrafts(game),
  // @endif
];
const crafts = [...localCrafts];

const createWorldObject = (properties) => {
  const object = new Asteroid({ ...properties, contents: [] });
  const amethystOnly = properties.contents.length &&
    properties.contents.every((resource) => itemTypes[resource] === amethyst);

  properties.contents.forEach((resource) =>
    object.bury(new Item({ itemData: itemTypes[resource] }), amethystOnly));

  properties.instance = object;
  object.worldObject = properties;

  return object;
};

const updateWorldObjects = () => {
  activeWorldObjects.length = scenery.length = 0;
  crafts.length = localCrafts.length;
  worldObjects.forEach((properties) => {
    let object = properties.instance || properties;

    if (object.dead || Math.hypot(object.x - playerShip.x, object.y - playerShip.y) > 2000) return;
    if (!properties.instance) object = createWorldObject(properties);
    activeWorldObjects.push(object);
    (properties.scenery ? scenery : crafts).push(object);
  });
};

const trackWorldObjects = (objects, scenery) => objects.forEach((object) => {
  if (object.worldObject) return;
  const properties = { instance: object, scenery };

  object.worldObject = properties;
  worldObjects.push(properties);
});

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  Object.assign(playerShip, {
    x: world.fields[0].x,
    y: world.fields[0].y,
  });
}
// @endif

updateWorldObjects();

// @ifdef BENCHMARK
window['testSections'] = () => testSections(scenery, playerShip, lamp);
// @endif

const items = [];

// Everything that can catch hold of a ship and carry it along
const movers = crafts;

const collide = (objects, targets) => {
  // @ifdef BENCHMARK
  if (benchmarkFlag('noCollisions')) {
    scoop(items, []);
    mine([]);
    if (targets) dock([]);
    resolve([]);
    return;
  }
  // @endif

  const found = contacts(objects, targets);

  scoop(items, found);
  mine(found);
  if (targets) dock(found.filter(({ other }) => other.dockSegment));
  resolve(found);
};

// Move every physical body and find what it has run into, without any one
// object type owning world collisions
const physics = (dt) => {
  // @ifdef BENCHMARK
  if (benchmarkFlag('noPhysics')) return;
  // @endif
  // @ifdef DEBUG
  if (!physicsOn) return;
  // @endif

  const otherCrafts = crafts.slice(1);
  const bodies = [...scenery, ...items, ...otherCrafts];
  const step = dt / 4;

  // @ifdef BENCHMARK
  if (!benchmarkFlag('noMovement')) {
  // @endif
    bodies.forEach((body) => {
      body.rotation += (body.spin || 0) * dt;
      move(body, dt);
      localMovement(body, movers, dt);
    });
  // @ifdef BENCHMARK
  }
  // @endif

  const world = [
    ...scenery.flatMap((asteroid) => asteroid.hitboxes()),
    ...items,
    ...otherCrafts.flatMap((craft) => craft.hitboxes()),
  ];

  for (let steps = 4; steps--;) {
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noMovement')) {
    // @endif
      playerShip.rotation += playerShip.spin * step;
      move(playerShip, step);
      localMovement(playerShip, movers, step);
    // @ifdef BENCHMARK
    }
    // @endif

    const hitboxes = playerShip.hitboxes();

    collide([...world, ...hitboxes], hitboxes);
  }

  collide(world);
};

// The player's lamp, kept to hand so what it is picking out can be worked out
// once a frame rather than hunted for in the segments every time
const lamp = playerShip.segments.find((segment) => segment.module === floodlight);

initKeys();

// @ifdef DEBUG
bindDebug();
// @endif

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
    const visibleScenery = scenery.filter((object) =>
      object.position.distance(playerShip.position) < game.width);
    const visibleCrafts = crafts.filter((object) =>
      object === playerShip || object.position.distance(playerShip.position) < game.width);

    // The sky slides past at its own pace, so it moves itself
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noBackground')) {
    // @endif
      renderBackground(game);
    // @ifdef BENCHMARK
    }
    // @endif

    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);

    // roads.forEach((road) => road.render());
    // Craft layers are global: a station floor can sit under every ship while
    // its hull and roof sit over them, using the same z-index as ship modules
    for (let zIndex = -3; zIndex < 4; zIndex++) {
      visibleScenery.filter((object) => object.zIndex === zIndex).forEach((object) => {
        object.render();
        // A loose leaf cannot be mined any smaller, so its cargo stays in view.
        object.sections || object.contents.forEach((item) => item.render());
      });

      if (zIndex === -2) {
        // Cargo still inside mineable asteroids shows only through the slice
        // the floodlight is crossing, as if the lamp lets a pilot peer inside
        // @ifdef DEBUG
        if (lights) {
        // @endif
          if (lamp.anim > 0.5) {
            const beam = traceBeam(playerShip, lamp, visibleScenery);
            const worldFrame = game.ctx.getTransform();

            game.ctx.save();
            game.ctx.translate(playerShip.x, playerShip.y);
            game.ctx.rotate(playerShip.rotation);
            game.ctx.translate(lamp.x, lamp.y);
            game.ctx.clip(insidePath(beam));
            game.ctx.clip(beam.mask);
            game.ctx.setTransform(worldFrame);

            visibleScenery.forEach((asteroid) =>
              asteroid.sections && asteroid.contents.forEach((item) => item.render()));

            game.ctx.restore();
          }
        // @ifdef DEBUG
        }
        // @endif

        items.forEach((item) => item.render());
      }

      visibleCrafts.forEach((craft) => renderCraft(craft, visibleScenery, zIndex));
    }

    // Sparks off the horn sit over the asteroids and ships they come off
    renderSparks(game);

    // Light rather than paint, so it goes over everything it lights up
    // @ifdef DEBUG
    if (lights) {
    // @endif
      renderBlasts(game);
    // @ifdef DEBUG
    }
    // @endif

    game.ctx.restore();

    // @ifdef DEBUG
    renderDebug(game, scenery, crafts);
    // @endif

    renderIndicators(game, stations, colors.green[2], 10000);
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

    // @ifdef DEBUG
    renderDebugDemos(game);
    // @endif
  },
  update: (dt) => {
    // roads.forEach((road) => road.update(dt));
    updateWorldObjects();

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

    localCrafts.forEach((craft) => craft.update(dt));
    activeWorldObjects.forEach((object) => object.update(dt, items));
    physics(dt);

    // Apply horn damage once per update, however many physics substeps found it
    [...scenery.flatMap((asteroid) => asteroid.sections || asteroid),
      ...items, ...crafts.flatMap((craft) => craft.segments)]
      .forEach((target) => grind(target, dt, scenery, items));
    activeWorldObjects
      .filter((object) => object.worldObject.scenery && !scenery.includes(object))
      .forEach((object) => object.dead = true);
    trackWorldObjects(scenery, true);
    trackWorldObjects(crafts.flatMap((craft) => craft.fracture(items)), false);
    followTarget(game, playerShip, dt);
  },
}).start();
