import { amethyst, itemTypes } from './items';
import { back, confirmSelection, moveSelection, renderDocked } from './ui/docked';
// @ifdef DEBUG
import {
  bindDebug,
  debugCrafts,
  lights,
  physicsOn,
  renderDebug,
  renderDebugDemos,
  showDeadzone,
} from './debug';
// @endif
import { bindKeys, initKeys, keyDown } from './keyboard';
import { camera, centerCamera, followTarget } from './camera';
import { cargoScoop, dockingBay, floodlight, horn, shield, thrusterDualMd } from './modules';
import { dock, flyOut } from './docking';
import { insidePath, traceBeam } from './prism';
import { player, updatePlayer } from './player';
import { renderBlasts, updateBlasts } from './explosion';
import { renderSparks, updateSparks } from './shrapnel';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { GameLoop } from './game-loop';
import { Item } from './item';
// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';
// @endif
import { colors } from './colors';
import { contacts } from './collisions';
import { game } from './game';
import { generateWorld } from './world';
import { mine } from './mining';
// import { Road } from './road';
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
world.wrecks.forEach((properties) => new Craft({
  ...properties,
  craftData: shipTypes.mustang,
  shades: colors.orange,
}));
world.fields.flatMap(({ asteroids }) => asteroids).forEach((properties) => {
  const object = new Asteroid({ ...properties, contents: [] });
  const amethystOnly = properties.contents.length &&
    properties.contents.every((resource) => itemTypes[resource] === amethyst);

  properties.contents.forEach((resource) =>
    object.bury(new Item({ itemData: itemTypes[resource] }), amethystOnly));
});

// @ifdef DEBUG
debugCrafts(game);
// @endif

// @ifdef BENCHMARK
if (benchmarkFlag('field')) {
  Object.assign(playerShip, {
    x: world.fields[0].x,
    y: world.fields[0].y,
  });
}
// @endif

// @ifdef BENCHMARK
window['testSections'] = () => testSections(
  game.sprites.filter(({ scenery }) => scenery), playerShip, lamp);
// @endif

// The player's lamp, kept to hand so what it is picking out can be worked out
// once a frame rather than hunted for in the segments every time
const lamp = playerShip.segments.find((segment) => segment.module === floodlight);
const activeRadius = 2000;
const nearbyRadius = 100;
const nearbySteps = 4;
let activeSprites = [];
let nearbySprites = [];
let updates = 0;

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
      activeSprites
        .filter((object) => object.scenery && object.zIndex === zIndex)
        .forEach((object) => {
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
            const beam = traceBeam(playerShip, lamp, activeSprites);
            const worldFrame = game.ctx.getTransform();

            game.ctx.save();
            game.ctx.translate(playerShip.x, playerShip.y);
            game.ctx.rotate(playerShip.rotation);
            game.ctx.translate(lamp.x, lamp.y);
            game.ctx.clip(insidePath(beam));
            game.ctx.clip(beam.mask);
            game.ctx.setTransform(worldFrame);

            activeSprites.forEach((asteroid) =>
              asteroid.scenery && asteroid.sections &&
              asteroid.contents.forEach((item) => item.render()));

            game.ctx.restore();
          }
        // @ifdef DEBUG
        }
        // @endif

        activeSprites.forEach((item) =>
          item.item && !item.buried && !item.dead && item.render());
      }

      activeSprites.forEach((craft) =>
        craft.segments && !craft.dead && renderCraft(craft, activeSprites, zIndex));
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

    // @ifdef DEBUG
    if (showDeadzone) {
      game.ctx.beginPath();
      game.ctx.arc(playerShip.x, playerShip.y, nearbyRadius, 0, Math.PI * 2);
      game.ctx.strokeStyle = colors.red[2];
      game.ctx.stroke();
    }
    // @endif

    game.ctx.restore();

    // @ifdef DEBUG
    renderDebug(game, activeSprites);
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
    // Things that happen every fourth update (~15 FPS): refresh the active tier.
    if (!(updates++ % 4)) {
      activeSprites = game.sprites.filter((sprite) =>
        sprite.position.distanceTo(playerShip.position) <= activeRadius);
    }

    // Things that happen every update (~60 FPS).
    nearbySprites = activeSprites.filter((sprite) =>
      !sprite.dead && sprite.position.distanceTo(playerShip.position) <= nearbyRadius);

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

    activeSprites.forEach((sprite) => {
      if (!sprite.dead && !nearbySprites.includes(sprite)) {
        sprite.update(
          dt,
          // @ifdef DEBUG
          physicsOn,
          // @endif
          // @ifdef BENCHMARK
          !benchmarkFlag('noPhysics') && !benchmarkFlag('noMovement'),
          // @endif
        );
      }
    });

    activePhysics: {
      // @ifdef DEBUG
      if (!physicsOn) break activePhysics;
      // @endif
      // @ifdef BENCHMARK
      if (benchmarkFlag('noPhysics')) break activePhysics;
      // @endif
      // @ifdef BENCHMARK
      if (benchmarkFlag('noCollisions')) break activePhysics;
      // @endif
      const spriteContacts = contacts(activeSprites.flatMap((sprite) => sprite.hitboxes()));

      scoop(spriteContacts);
      mine(spriteContacts, dt);
      dock(spriteContacts);
      resolve(spriteContacts);
    }

    // Things that happen four times per update (~240 FPS): the nearby tier gets
    // four smaller movements and collision passes, preserving one dt in total.
    for (let step = nearbySteps; step--;) {
      nearbySprites.forEach((sprite) => {
        if (!sprite.dead) {
          sprite.update(
            dt / nearbySteps,
            // @ifdef DEBUG
            physicsOn,
            // @endif
            // @ifdef BENCHMARK
            !benchmarkFlag('noPhysics') && !benchmarkFlag('noMovement'),
            // @endif
          );
        }
      });

      nearbyPhysics: {
        // @ifdef DEBUG
        if (!physicsOn) break nearbyPhysics;
        // @endif
        // @ifdef BENCHMARK
        if (benchmarkFlag('noPhysics')) break nearbyPhysics;
        // @endif
        // @ifdef BENCHMARK
        if (benchmarkFlag('noCollisions')) break nearbyPhysics;
        // @endif
        const nearbySpriteContacts = contacts(
          nearbySprites.flatMap((sprite) => sprite.hitboxes()));

        resolve(nearbySpriteContacts);
      }
    }

    followTarget(game, playerShip, dt);
  },
}).start();
