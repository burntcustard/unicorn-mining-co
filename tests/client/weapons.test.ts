/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { initKeys, playerInput } from '${root}/src/client/input/input.ts';
import { moduleBinding } from '${root}/src/client/input/keybindings.ts';
import { createPlayerShip } from '${root}/src/client/objects/create-ship.ts';
import {
  createWorld,
  addEntity,
  addPlayer,
} from '${root}/src/client/simulation/world.ts';
import { PredictionManager } from '${root}/src/client/prediction/prediction.ts';
import { updateWorld } from '${root}/src/client/simulation/update-world.ts';
import {
  cloneEntity,
  captureWorld,
  restoreWorld,
} from '${root}/src/client/simulation/world-state.ts';
import { controlShip } from '${root}/src/client/objects/control-ship.ts';
import {
  Autogun,
  Laser,
  PlasmaAccelerator,
  ShieldGenerator,
  ShieldGeneratorMd,
  moduleTypes,
} from '${root}/src/client/objects/modules/index.ts';
import { Craft } from '${root}/src/client/objects/craft.ts';
import { Weapon } from '${root}/src/client/objects/modules/weapon.ts';
import { contactBetween } from '${root}/src/client/collision/contact-between.ts';
import { GameObject } from '${root}/src/client/objects/game-object.ts';
import { Projectile } from '${root}/src/client/objects/projectile.ts';
import { Station } from '${root}/src/client/objects/station.ts';
import { explode } from '${root}/src/client/objects/explosion.ts';
import { updateEntities } from '${root}/src/client/simulation/update-tier.ts';
import { damage } from '${root}/src/client/objects/damage.ts';
import { Asteroid } from '${root}/src/client/objects/asteroid.ts';
import { Item } from '${root}/src/client/objects/item.ts';
import { autogunAmmunition, gold } from '${root}/src/specs/items/index.ts';
import { moduleSpecs } from '${root}/src/specs/modules/index.ts';
import { game } from '${root}/src/client/game.ts';
import { colors, paintColors } from '${root}/src/specs/colors.ts';
import { withAlpha } from '${root}/src/client/utilities/color.ts';
import { presentEvents } from '${root}/src/client/effects/present-events.ts';
import { effects } from '${root}/src/client/effects/effect.ts';
import { sparks } from '${root}/src/client/effects/shrapnel.ts';
import { renderingLayers } from '${root}/src/specs/rendering-layers.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';
import { moduleSpecForSimulation } from '${root}/src/client/utilities/module-spec.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';
globalThis.Path2D = class {
  moveTo() {}
  lineTo() {}
  closePath() {}
};
globalThis.window = new EventTarget();
initKeys();
// A laser damages the nearest surface continuously without spawning projectiles.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));
  addPlayer(world, { id: 1, shipId: ship.id });
  const laser = new Laser();
  ship.fit(laser, ship.mounts.find((mount) => mount.fits.includes(Laser)));
  const y = laser.mount.localPosition.y;
  const near = addEntity(world, new GameObject({ world, position: Vec.create(150, y), radius: 10, health: 100 }));
  const far = addEntity(world, new GameObject({ world, position: Vec.create(250, y), radius: 10, health: 100 }));
  controlShip(ship, { ...playerInput, laserActive: true, fire: true }, []);
  ship.resolveLasers(1, []);
  assert.equal(near.health, 100, 'deployment cannot damage a target');
  ship.updateModules(laser.activationDuration);
  const laserEvents = [];
  for (let tick = 0; tick < 30; tick++) {
    updateEntities({ world, events: laserEvents });
  }
  const hits = laserEvents.filter((event) => event.type === 'laserDamage');
  assert.equal(hits.length, 30, 'steady beams damage once per tick, across two movement substeps');
  assert(hits.every((event) => Math.abs(event.damage - 0.1) < 1e-8 && event.targetId === near.id));
  assert(hits.every((event) => Math.abs(event.position.x - 140) < 2 && event.position.y === y), 'sparks originate at the first contacted surface');
  sparks.length = 0;
  presentEvents({ events: laserEvents });
  assert.equal(sparks.length, 30, 'each beam damage event presents a contact spark');
  assert.deepEqual(sparks[0].position, hits[0].position);
  assert.equal(sparks[0].color, hits[0].color);
  sparks.length = 0;
  assert(Math.abs(near.health - 97) < 1e-8, 'one second deals 3 damage');
  assert.equal(far.health, 100, 'the first surface blocks the beam');
  assert.equal([...world.entities.values()].filter((entity) => entity instanceof Projectile).length, 0);
  const checkpoint = captureWorld({ world });
  ship.resolveLasers(0.5, []);
  restoreWorld({ world, state: checkpoint });
  assert(Math.abs(near.health - 97) < 1e-8, 'rollback restores laser damage');
  const tapEvents = [];
  updateEntities({
    world,
    events: tapEvents,
    inputs: new Map([[1, {
      input: { ...playerInput, laserActive: true, fire: true },
      changes: [{ offset: 0.01, input: { ...playerInput, laserActive: true, fire: false } }],
    }]]),
  });
  assert(Math.abs(near.health - (97 - 3 * 0.01)) < 1e-8, 'short fire taps retain their damage duration');
  assert.equal(tapEvents.filter((event) => event.type === 'laserDamage').length, 1);
  restoreWorld({ world, state: checkpoint });
  ship.firing = false;
  ship.resolveLasers(1, []);
  assert(Math.abs(near.health - 97) < 1e-8, 'releasing Space stops damage immediately');
  ship.firing = true;
  ship.setModuleActive({ module: Laser, active: false });
  ship.resolveLasers(1, []);
  assert(Math.abs(near.health - 97) < 1e-8, 'retraction stops damage immediately');
  ship.setModuleActive({ module: Laser, active: true });
  ship.updateModules(1);
  near.position.x = 1000;
  far.position.x = 1200;
  ship.resolveLasers(1, []);
  assert(Math.abs(near.health - 97) < 1e-8, 'targets outside beam range are untouched');
  near.position = Vec.create(-y, 150);
  far.position = Vec.create(-y, 250);
  ship.rotation = Math.PI / 2;
  ship.resolveLasers(0.2, []);
  assert(Math.abs(near.health - 96.4) < 1e-8, 'the beam follows ship rotation');
  assert.equal(far.health, 100);
}
// Deployment and firing are independent, including reversals partway through.
for (const Type of [PlasmaAccelerator, Autogun]) {
  const deploymentWorld = createWorld();
  const deployedShip = addEntity(deploymentWorld, createPlayerShip(deploymentWorld, { playerId: 1 }));
  addPlayer(deploymentWorld, { id: 1, shipId: deployedShip.id });
  const gun = new Type();
  const shutdown = gun.activationDuration + (gun.dischargeDuration ?? 0);
  const ratio = shutdown / gun.activationDuration;
  deployedShip.fit(gun, deployedShip.mounts.find((mount) => mount.fits.includes(Type)));
  const pack = new Item(autogunAmmunition);
  deployedShip.cargoContents.push(pack);
  const segments = deployedShip.segmentsAtMount(gun.mount);
  const part = segments[0];
  const authored = moduleSpecs[gun.definitionId].model[0].points;
  const points = () => part.points(part);
  const shots = () => [...deploymentWorld.entities.values()].filter((entity) => entity instanceof Projectile).length;
  const controls = (active, fire = true) => controlShip(deployedShip, { ...playerInput, plasmaActive: Type === PlasmaAccelerator && active, autogunActive: Type === Autogun && active, fire }, []);
  assert.equal(points()[0][0], authored[0][0] - gun.retractionDistance, 'inactive weapons use the shortened retraction distance');
  const side = Math.sign(gun.mount.localPosition.y) || 1;
  assert.equal(points()[0][1], authored[0][1] * side, 'deployment preserves mirrored y coordinates');
  controls(false);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 0, 'Space cannot deploy or fire a retracted weapon');
  controls(true);
  deployedShip.updateModules(gun.activationDuration / 2);
  assert.equal(part.activationProgress, 0.5);
  assert.equal(points()[0][0], authored[0][0] - gun.retractionDistance / 2);
  const checkpoint = captureWorld({ world: deploymentWorld });
  deployedShip.fireWeapons(1);
  assert.equal(shots(), 0, 'activation cannot fire or catch up missed shots');
  assert.equal(pack.rounds, 200, 'deployment consumes no ammunition');
  const health = gun.mount.health;
  assert.equal(damage(part, 1), 1, 'active weapons can take damage');
  assert.equal(gun.mount.health, health - 1);
  controls(false);
  deployedShip.updateModules(gun.activationDuration / 4);
  assert(Math.abs(part.activationProgress - 0.25 / ratio) < 1e-9, 'reversing smoothly retracts from current progress');
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 0, 'retraction cannot fire');
  assert.equal(damage(part, 1), 0, 'deactivated weapons are invulnerable');
  restoreWorld({ world: deploymentWorld, state: checkpoint });
  assert.equal(deployedShip.firing, true, 'rollback restores held fire');
  assert.equal(part.activationProgress, 0.5, 'rollback restores deployment progress');
  deployedShip.updateModules(gun.activationDuration / 2);
  assert.equal(part.activationProgress, 1);
  assert.equal(points()[0][0], authored[0][0]);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 0, 'full deployment starts uncharged');
  assert.equal(gun.chargeCooldown, gun.chargeDuration, 'deployment spends no time charging');
  const chargingCheckpoint = captureWorld({ world: deploymentWorld });
  deployedShip.updateModules(gun.chargeDuration / 2);
  assert.equal(gun.chargeCooldown, gun.chargeDuration / 2);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 0, 'charging and spin-up block firing');
  controls(false, false);
  deployedShip.updateModules(0.01);
  assert.equal(gun.chargeCooldown, gun.chargeDuration, 'retraction resets readiness');
  restoreWorld({ world: deploymentWorld, state: chargingCheckpoint });
  assert.equal(gun.chargeCooldown, gun.chargeDuration, 'rollback restores charging independently of firing');
  deployedShip.updateModules(gun.chargeDuration - 0.001);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 0, 'weapons wait for the final charge boundary');
  deployedShip.updateModules(0.001);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 1, 'completed charge allows held Space to fire');
  controls(true, false);
  deployedShip.fireWeapons(gun.fireInterval);
  assert.equal(shots(), 1, 'deployed weapons need held fire');
  controls(false);
  deployedShip.fireWeapons(0);
  assert.equal(shots(), 1, 'retraction blocks fire immediately even at progress one');
  deployedShip.updateModules(shutdown);
  assert.equal(part.activationProgress, 0);
  controls(true);
  deployedShip.updateModules(gun.activationDuration + gun.chargeDuration / 2);
  assert(Math.abs(gun.chargeCooldown - gun.chargeDuration / 2) < 1e-9, 'a long update charges only its time after full deployment');
  controls(false);
  deployedShip.updateModules(shutdown);
  if (Type === Autogun) {
    const spin = (activation, charge) => {
      part.activationProgress = activation;
      part.active = Number(activation > 0);
      part.phase = 0;
      gun.fireCooldown = 0;
      gun.chargeCooldown = charge;
      gun.updateVisual({ craft: deployedShip, segments: [part], dt: 0.01 });
      return part.phase;
    };
    assert.equal(spin(0, gun.chargeDuration), 0, 'inactive autogun does not spin');
    assert.equal(spin(0.5, gun.chargeDuration), 0, 'deploying autogun does not spin');
    assert.equal(spin(1, gun.chargeDuration), 0, 'just deployed autogun starts stationary');
    assert(Math.abs(spin(1, gun.chargeDuration / 2) * 2 - spin(1, 0)) < 1e-9, 'spin speed ramps after deployment');
    part.active = 0;
    part.activationProgress = 0;
    gun.fireCooldown = gun.fireInterval;
    const stopped = part.phase;
    gun.updateVisual({ craft: deployedShip, segments: [part], dt: 0.1 });
    assert.equal(part.phase, Math.ceil(stopped), 'inactive autogun finishes at a stacked position');
    const render = Weapon.prototype.render;
    const drawn = [];
    Weapon.prototype.render = ({ segment, points }) => drawn.push(points ?? segment.points(segment));
    for (const start of [-0.5, 0.1, 1.4, 3.9]) {
      for (const frames of [1, 7, 21]) {
        part.phase = start;
        part.activationProgress = 1;
        const step = gun.dischargeDuration / frames;
        for (let frame = 1; frame <= frames; frame++) {
          part.activationProgress = 1 - frame / frames * gun.dischargeDuration / shutdown;
          gun.updateVisual({ craft: deployedShip, segments: [part], dt: step });
          const expected = Math.ceil(start) - (Math.ceil(start) - start) * (1 - frame / frames) ** 2;
          assert(Math.abs(part.phase - expected) < 1e-9, 'spin-down has the same easing and duration at every starting angle and frame rate');
          drawn.length = 0;
          gun.render({ segment: part });
          assert.equal(drawn[0][0][0], authored[0][0], 'barrels remain deployed throughout spin-down');
        }
        assert(part.phase === Math.ceil(start), 'spin-down finishes exactly stacked before retraction');
      }
    }
    part.activationProgress = 0.5 / ratio;
    drawn.length = 0;
    gun.render({ segment: part });
    assert.equal(drawn[0][0][0], authored[0][0] - gun.retractionDistance / 2, 'retraction follows spin-down and slides from the stacked position');
    Weapon.prototype.render = render;
    controls(true, false);
    segments.forEach((segment) => { segment.activationProgress = 1; });
    controls(false, false);
    deployedShip.updateModules(gun.dischargeDuration);
    assert.equal(points()[0][0], authored[0][0], 'simulation holds the barrels extended for the complete spin-down');
    deployedShip.updateModules(gun.activationDuration / 2);
    assert(Math.abs(points()[0][0] - (authored[0][0] - gun.retractionDistance / 2)) < 1e-9, 'retraction uses the same slide duration as extension');
    const beforeReversal = points()[0][0];
    controls(true, false);
    assert.equal(points()[0][0], beforeReversal, 'reactivating during retraction preserves the barrel position');
    deployedShip.updateModules(gun.activationDuration / 2);
    assert.equal(part.activationProgress, 1, 'reversed extension completes from its current position');
  }
}
// Both weapons read independent movement, charge and discharge durations.
for (const Type of [PlasmaAccelerator, Autogun]) {
  const timingWorld = createWorld();
  const craft = addEntity(timingWorld, createPlayerShip(timingWorld, { playerId: 1 }));
  const spec = { ...moduleSpecs[Type.definitionId], activationDuration: 400, chargeDuration: 900, dischargeDuration: 600 };
  const runtimeSpec = moduleSpecForSimulation(spec);
  const gun = new Type({ ...runtimeSpec, model: Type.createModel(runtimeSpec) });
  craft.fit(gun, craft.mounts.find((mount) => mount.fits.includes(Type)));
  const part = craft.segmentsAtMount(gun.mount)[0];
  const barrelX = () => part.points(part)[0][0];
  const extendedX = spec.model[0].points[0][0];
  craft.setModuleActive({ module: Type, active: true });
  craft.updateModules(spec.activationDuration / 1000);
  assert.equal(barrelX(), extendedX, 'movement completes independently of charge duration');
  assert.equal(gun.chargeCooldown, spec.chargeDuration / 1000, 'charge starts after extension');
  craft.updateModules(spec.chargeDuration / 1000);
  assert.equal(gun.chargeCooldown, 0, 'configured charge duration controls readiness');
  craft.setModuleActive({ module: Type, active: false });
  craft.updateModules(spec.dischargeDuration / 1000);
  assert.equal(barrelX(), extendedX, 'configured discharge duration delays retraction for either weapon');
  craft.updateModules(spec.activationDuration / 2000);
  assert(Math.abs(barrelX() - (extendedX - spec.retractionDistance / 2)) < 1e-9, 'retraction uses the configured movement duration');
  const before = barrelX();
  craft.setModuleActive({ module: Type, active: true });
  assert(Math.abs(barrelX() - before) < 1e-9, 'reversal keeps the barrel position with independent timings');
}
// A shield bubble has a separate pool, collapses, and recharges while inactive.
for (const Type of [ShieldGenerator, ShieldGeneratorMd]) {
  const world = createWorld();
  const craft = addEntity(world, new Craft({ world, hullSegments: [{ health: 100, points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], mounts: [[{ x: 20, y: 20, fits: [Type.definitionId] }]] }] }));
  const gun = new Type({ health: 13, healthActivated: 31, rechargeDuration: 2 });
  craft.fit(gun, craft.mounts.find((mount) => mount.fits.includes(Type)));
  const parts = craft.segmentsAtMount(gun.mount);
  const body = parts.find((part) => !part.covers);
  const bubble = parts.find((part) => part.covers);
  assert.equal(damage(body, 5), 5);
  assert.equal(gun.mount.health, 8, 'inactive damage reaches the physical generator');
  craft.setModuleActive({ module: Type, active: true });
  craft.updateModules(gun.coverDuration);
  damage(bubble, 17);
  assert.equal(gun.mount.healthActivated, 14);
  assert.equal(gun.mount.health, 8, 'bubble damage preserves the generator pool');
  const checkpoint = captureWorld({ world });
  damage(bubble, 100);
  assert.equal(bubble.activationProgress, 0, 'depleting the bubble pops it immediately');
  assert(!craft.moduleActive({ module: Type }), 'bubble depletion disables the shield immediately');
  craft.updateModules(0);
  assert(!craft.moduleActive({ module: Type }), 'a popped bubble deactivates its generator');
  craft.setModuleActive({ module: Type, active: true });
  assert(!craft.moduleActive({ module: Type }), 'a depleted shield cannot reactivate');
  craft.updateModules(gun.rechargeDuration / 2);
  assert.equal(gun.mount.healthActivated, gun.healthActivated / 2);
  craft.setModuleActive({ module: Type, active: true });
  assert(!craft.moduleActive({ module: Type }), 'partial recharge cannot activate the shield');
  const charging = captureWorld({ world });
  craft.updateModules(gun.rechargeDuration / 2);
  craft.setModuleActive({ module: Type, active: true });
  assert(craft.moduleActive({ module: Type }), 'a completely recharged shield can activate');
  restoreWorld({ world, state: charging });
  assert.equal(gun.mount.healthActivated, gun.healthActivated / 2, 'rollback preserves recharge progress');
  restoreWorld({ world, state: checkpoint });
  assert.equal(gun.mount.healthActivated, 14, 'rollback restores both pools and activation');
  assert.equal(gun.mount.health, 8);
  assert(craft.moduleActive({ module: Type }));
  const states = craft.moduleStates;
  const clone = cloneEntity({ entity: craft });
  clone.moduleStates = states;
  assert.equal(clone.modules.find((module) => module.id === gun.id).mount.healthActivated, 14, 'snapshots preserve bubble health');
}
// Recoil is an impulse per successful shot, opposite the ship's facing.
for (const weapon of [PlasmaAccelerator, Autogun])
  for (const rotation of [0, Math.PI / 2, Math.PI])
    for (const moving of [false, true]) {
      const recoilWorld = createWorld();
      const recoilShip = addEntity(
        recoilWorld,
        createPlayerShip(recoilWorld, {
          playerId: 1,
          rotation,
          velocity: moving ? Vec.create(7, -3) : Vec.create(),
        }),
      );
      recoilWorld.players.set(1, { id: 1, shipId: recoilShip.id });
      const gun = new weapon();
      recoilShip.fit(
        gun,
        recoilShip.mounts.find((mount) => mount.fits.includes(weapon)),
      );
      recoilShip.cargoContents.push(new Item(autogunAmmunition));
      recoilShip.setModuleActive({ module: weapon, active: true });
      recoilShip.updateModules(gun.activationDuration + gun.chargeDuration);
      recoilShip.firing = true;
      const startingVelocity = Vec.clone(recoilShip.velocity),
        start = Vec.clone(recoilShip.position);
      recoilShip.fireWeapons(0);
      const shot = [...recoilWorld.entities.values()].find(
        (entity) => entity instanceof Projectile,
      );
      assert(shot, 'a successful shot is required for recoil');
      const impulse = Vec.subtract(recoilShip.velocity, startingVelocity);
      const amount = (gun.recoil ?? 0) / recoilShip.mass;
      assert(
        Math.abs(impulse.x + Math.cos(rotation) * amount) < 1e-9 &&
          Math.abs(impulse.y + Math.sin(rotation) * amount) < 1e-9,
        'recoil applies the configured mass-scaled impulse, rotated with the ship',
      );
      assert.equal(recoilShip.spin, 0, 'recoil does not turn the ship');
      assert(
        Math.abs(
          Vec.distance(shot.velocity, startingVelocity) - gun.projectile.speed,
        ) < 1e-9,
        'the projectile inherits velocity before recoil',
      );
      const after = Vec.clone(recoilShip.velocity);
      recoilShip.fireWeapons(0.01);
      assert.deepEqual(
        recoilShip.velocity,
        after,
        'cooldown does not repeatedly apply recoil',
      );
      recoilShip.update(1 / 30);
      if (!moving && weapon === PlasmaAccelerator) {
        assert(
          Vec.distance(start, recoilShip.position) > 0,
          'a stationary ship really moves on the next update',
        );
        assert(
          Vec.dot(Vec.subtract(recoilShip.position, start), impulse) > 0,
          'the displacement follows the recoil',
        );
      }
    }
const world = createWorld();
const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));
world.players.set(1, { id: 1, shipId: ship.id });
const plasma = new PlasmaAccelerator(),
  auto = new Autogun();
ship.fit(
  plasma,
  ship.mounts.find((mount) => mount.fits.includes(PlasmaAccelerator)),
);
ship.fit(
  auto,
  ship.mounts.find(
    (mount) => mount.fits.includes(Autogun) && mount.module !== plasma,
  ),
);
const keyEvent = (type, key = ' ') =>
  window.dispatchEvent(
    Object.assign(new Event(type), { key, repeat: false }),
  );
keyEvent('keydown', 'p');
keyEvent('keyup', 'p');
controlShip(ship, playerInput, []);
assert(ship.moduleActive({ module: PlasmaAccelerator }) && !ship.moduleActive({ module: Autogun }), 'P deploys only plasma');
keyEvent('keydown', 'a');
keyEvent('keyup', 'a');
keyEvent('keydown');
controlShip(ship, playerInput, []);
assert(
  ship.moduleActive({ module: PlasmaAccelerator }) &&
    ship.moduleActive({ module: Autogun }),
  'P and A independently deploy both fitted weapons',
);
ship.setModuleActive({ module: Autogun, active: false });
controlShip(ship, playerInput, []);
assert(
  ship.moduleActive({ module: PlasmaAccelerator }) &&
    ship.moduleActive({ module: Autogun }),
  'weapon toggle synchronizes weapons with different activation states',
);
assert.equal(
  moduleBinding('plasmaActive').mode,
  'toggle',
  'weapons activate with a toggle binding',
);
const ammo = new Item(autogunAmmunition);
assert.equal(ammo.rounds, 200, 'a new ammunition pack contains 200 rounds');
ship.cargoContents.push(new Item(gold), ammo);
ship.updateModules(3);
ship.fireWeapons(0);
for (let tick = 1; tick < 120; tick++) ship.fireWeapons(1 / 120);
const shots = [...world.entities.values()].filter(
  (entity) => entity instanceof Projectile,
);
assert.equal(
  shots.filter((shot) => shot.definitionId === 'plasmaAccelerator').length,
  1,
);
assert.equal(
  shots.filter((shot) => shot.definitionId === 'autogun').length,
  4,
  'autogun fires four shots per second',
);
for (const shot of shots) {
  const spec = moduleSpecs[shot.definitionId].projectile;
  assert.equal(
    shot.radius,
    spec.radius,
    'collision radius comes from the nested projectile settings',
  );
  assert.equal(
    shot.health,
    moduleSpecs[shot.definitionId].damage,
    'projectile health starts at its weapon damage',
  );
  const inherited =
    shot.definitionId === 'plasmaAccelerator' ? Vec.create() : ship.velocity;
  assert(
    Math.abs(Vec.distance(shot.velocity, inherited) - spec.speed) < 1e-6,
    'firing uses the nested projectile speed',
  );
}
assert.equal(ammo.rounds, 196, 'one round consumed per shot');
assert(
  ship.cargoContents.includes(ammo),
  'partially used packs remain in cargo',
);
assert(
  ship.cargoContents.some((item) => item.resource === gold.resource),
  'ore is not ammunition',
);
assert(
  moduleSpecs.plasmaAccelerator.projectile.speed <
    moduleSpecs.autogun.projectile.speed,
);
const checkpoint = captureWorld({ world });
const cooldown = plasma.fireCooldown;
ship.fireWeapons(0.25);
assert.equal(ammo.rounds, 195);
restoreWorld({ world, state: checkpoint });
assert.equal(
  ammo.rounds,
  196,
  'rollback restores ammunition remaining in cargo',
);
assert.equal(plasma.fireCooldown, cooldown, 'rollback restores firing cadence');
const state = ship.moduleStates.find(
  (state) => state.type === moduleTypes.indexOf(PlasmaAccelerator),
);
assert.equal(
  state.fireCooldown,
  cooldown,
  'replication carries weapon cooldown',
);
for (let shot = 0; shot < 196; shot++) ship.fireWeapons(0.25);
assert(
  !ship.cargoContents.includes(ammo),
  'a pack is removed after its 200th shot',
);
assert.equal(
  [...world.entities.values()].filter(
    (shot) => shot.definitionId === 'autogun',
  ).length,
  200,
);
ship.fireWeapons(0.25);
assert.equal(
  [...world.entities.values()].filter(
    (shot) => shot.definitionId === 'autogun',
  ).length,
  200,
  'empty autogun cannot fire',
);
const lastRound = new Item(autogunAmmunition, { rounds: 1 }),
  nextPack = new Item(autogunAmmunition);
ship.cargoContents.push(lastRound, nextPack);
ship.fireWeapons(0);
ship.fireWeapons(0.25);
assert(
  !ship.cargoContents.includes(lastRound) && nextPack.rounds === 199,
  'firing continues into the next pack',
);
ship.cargoContents = ship.cargoContents.filter((item) => item.resource !== 5);
keyEvent('keyup');
controlShip(ship, playerInput, []);
assert(
  ship.moduleActive({ module: PlasmaAccelerator }) &&
    ship.moduleActive({ module: Autogun }) && !ship.firing,
  'releasing Space stops firing while weapons stay deployed',
);
keyEvent('keydown');
controlShip(ship, playerInput, []);
window.dispatchEvent(new Event('blur'));
controlShip(ship, playerInput, []);
assert(
  ship.moduleActive({ module: PlasmaAccelerator }) &&
    ship.moduleActive({ module: Autogun }) && !ship.firing,
  'losing focus releases fire without retracting weapons',
);
const before = world.entities.size;
ship.fireWeapons(1);
assert.equal(world.entities.size, before, 'released guns do not fire');
controlShip(ship, { ...playerInput, fire: true }, []);
ship.dockedTo = 100;
ship.fireWeapons(1);
assert.equal(world.entities.size, before, 'docked guns do not fire');
ship.dockedTo = 0;
ship.launching = 1;
ship.fireWeapons(1);
assert.equal(world.entities.size, before, 'launching guns do not fire');

for (const id of ['plasmaAccelerator', 'autogun']) {
  for (const maxHealth of [31, 71])
    for (const previousDamage of [0, 10.5]) {
      const targetWorld = createWorld();
      const outline = [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ];
      const asteroid = addEntity(
        targetWorld,
        new Asteroid({
          world: targetWorld,
          id: 200,
          position: Vec.create(),
          radius: 15,
          mass: 10,
          health: 100,
          maxHealth: 100,
          contents: [],
          resource: maxHealth === 71 ? 1 : 0,
          shapeOutline: outline,
          segments: [
            {
              contents: [],
              health: maxHealth,
              maxHealth,
              mass: 10,
              shapeOutline: outline,
            },
          ],
        }),
      );
      damage(asteroid.segments[0], previousDamage);
      const amount = moduleSpecs[id].damage;
      const count = Math.floor((asteroid.segments[0].health - 1) / amount) + 1;
      const events = [];
      for (let n = 1; n <= count; n++) {
        Vec.set(asteroid.velocity, Vec.create());
        asteroid.spin = 0;
        const projectile = addEntity(
          targetWorld,
          new Projectile(id, {
            world: targetWorld,
            id: 300 + n,
            playerId: 1,
            position: Vec.create(-80, 0),
            velocity: Vec.create(600, 0),
          }),
        );
        projectile.captureSweep();
        projectile.update(0.3);
        sparks.length = effects.length = 0;
        const beforeEvents = events.length;
        projectile.resolveHits(events, targetWorld, 0.3);
        const hit = events
          .slice(beforeEvents)
          .find((event) => event.type === 'collision');
        assert(
          hit,
          'a projectile hit emits the same collision event as physical impacts',
        );
        assert.equal(hit.a, projectile.id);
        assert.equal(hit.b, asteroid.id);
        assert.equal(
          hit.damage[0],
          amount,
          'the projectile takes its own weapon damage',
        );
        assert(
          projectile.health <= 0,
          'self damage exhausts the projectile health',
        );
        assert.equal(
          hit.colors[0],
          moduleSpecs[id].projectile.color,
          'projectile sparks use their own configured colour',
        );
        assert.equal(
          hit.damage[1],
          amount,
          'each hit applies the same weapon damage regardless of segment strength or earlier damage',
        );
        assert(
          hit.position.x > -15 &&
            hit.position.x < -9 &&
            Math.abs(hit.position.y) < 1e-6,
          'the contact is on the swept path at the near face, not the projectile endpoint',
        );
        assert.equal(
          hit.colors[1],
          colors[maxHealth === 71 ? 'violet' : 'white'][2],
          'rock sparks use the struck asteroid outline colour',
        );
        assert.equal(
          sparks.length,
          0,
          'hit resolution keeps presentation out of simulation',
        );
        assert.equal(
          effects.length,
          0,
          'simulation does not create visual effects',
        );
        presentEvents({ events: events.slice(beforeEvents) });
        assert.equal(
          effects.length,
          1,
          'only configured projectiles present an explosion',
        );
        assert.equal(
          sparks.length,
          4,
          'dedicated effects replace projectile sparks while preserving target sparks',
        );
        assert(
          sparks.every((spark) => spark.color === hit.colors[1]),
          'target damage emits the struck surface colour',
        );
        assert(
          sparks.every(
            (spark) => Vec.distance(spark.position, hit.position) < 1e-8,
          ),
          'both bursts use the impact position',
        );
        assert(
          projectile.dead,
          'a fast projectile hits the polygon instead of tunnelling through',
        );
        assert.equal(
          events.some((event) => event.type === 'asteroidSplit'),
          n === count,
          'a chunk splits only when accumulated damage takes its health below one',
        );
      }
    }
}
const remote = addEntity(world, createPlayerShip(world, { playerId: 2 }));
const remoteGun = new PlasmaAccelerator();
remote.fit(
  remoteGun,
  remote.mounts.find((mount) => mount.fits.includes(PlasmaAccelerator)),
);
controlShip(remote, { ...playerInput, fire: true }, []);
const beforeRemote = world.entities.size;
remote.fireWeapons(1);
assert.equal(
  world.entities.size,
  beforeRemote,
  'remote ships use replicated shots instead of creating duplicates',
);
const circleWorld = createWorld();
const friendly = addEntity(
  circleWorld,
  new GameObject({
    id: 1,
    playerId: 1,
    health: 100,
    radius: 5,
    position: Vec.create(-10, 0),
  }),
);
const far = addEntity(
  circleWorld,
  new GameObject({
    id: 2,
    playerId: 2,
    health: 100,
    radius: 5,
    position: Vec.create(40, 0),
  }),
);
const near = addEntity(
  circleWorld,
  new GameObject({
    id: 3,
    playerId: 2,
    health: 100,
    radius: 5,
    position: Vec.create(20, 0),
  }),
);
const circleShot = addEntity(
  circleWorld,
  new Projectile('autogun', {
    id: 4,
    playerId: 1,
    position: Vec.create(-80, 0),
    velocity: Vec.create(600, 0),
  }),
);
circleShot.update(0.3);
const circleEvents = [];
circleShot.resolveHits(circleEvents, circleWorld, 1 / 30);
assert.equal(
  circleEvents[0].damage[1],
  4,
  'circle hits also report damage through collision events',
);
assert(circleShot.dead);
assert.equal(friendly.health, 100, 'projectiles ignore the firing player');
assert.equal(
  near.health,
  96,
  'the closest circle receives damage across a catch-up sweep',
);
assert.equal(far.health, 100, 'a shot cannot damage two targets');
const hydration = new Projectile('autogun', { health: 1.25 });
assert(hydration instanceof Projectile);
assert.equal(
  hydration.health,
  1.25,
  'remaining projectile health survives hydration',
);
assert.equal(
  hydration.radius,
  2,
  'autogun rounds use the larger collision and render radius',
);
hydration.update(2);
assert(hydration.dead, 'projectiles expire');

// Station interiors absorb swept projectiles silently, including explosive rounds.
for (const id of ['autogun', 'plasmaAccelerator']) {
  for (const mode of ['hull', 'module', 'ship', 'nearerImpact']) {
    const world = createWorld();
    const station = addEntity(world, new Station({
      hullSegments: [{
        disablePhysics: true,
        health: 100,
        points: [[40, -20], [60, -20], [60, 20], [40, 20]],
      }],
    }));
    if (mode === 'module') station.segments[0].hull = false;
    if (mode === 'ship') station.kind = 'ship';
    const target = addEntity(world, new GameObject({
      position: Vec.create(mode === 'nearerImpact' ? 20 : 80, 0),
      radius: 5,
      health: 100,
    }));
    const health = station.segments[0].health;
    const shot = addEntity(world, new Projectile(id, {
      position: Vec.create(),
      velocity: Vec.create(1000, 0),
    }));
    shot.captureSweep();
    shot.update(0.1);
    const events = [];
    shot.resolveHits(events, world, 0.1);
    assert(shot.dead && !world.entities.has(shot.id), 'hits remove the projectile');
    if (mode === 'hull') {
      assert.equal(events.length, 0, 'station interiors emit no impact, death, or explosion effects');
      assert.equal(station.segments[0].health, health, 'the nonphysical hull takes no damage');
      assert.equal(target.health, 100, 'the projectile cannot hit a target behind the hull');
      assert.equal(Vec.length(target.velocity), 0, 'absorbed explosive projectiles exert no impulse');
      updateWorld({ world, inputs: new Map(), dt: 2 }).forEach(event => {
        assert.notEqual(event.objectId, shot.id, 'removed projectiles cannot later emit expiry effects');
      });
    } else {
      assert(events.some(event => event.type === 'collision' && event.b === target.id),
        'other nonphysical segments are ignored and earlier physical impacts still resolve');
    }
  }
}

{
  const blastWorld = createWorld();
  const source = addEntity(blastWorld, new GameObject({ id: 1 }));
  const neighbour = addEntity(
    blastWorld,
    new GameObject({
      id: 2,
      position: Vec.create(10, 0),
      mass: 1,
      health: 100,
    }),
  );
  explode({ object: source, radius: 20, impulse: 8 });
  assert.equal(
    neighbour.velocity.x,
    4,
    'ordinary game objects can use the shared explosion',
  );
  assert.equal(
    neighbour.health,
    100,
    'the shared impulse does not add splash damage',
  );
  assert.equal(
    Vec.length(source.velocity),
    0,
    'the source does not push itself',
  );
  assert(
    !source.dead,
    'the shared explosion does not own the source lifecycle',
  );
  const spin = neighbour.spin;
  assert(
    spin !== 0 && Math.abs(spin) <= 3,
    'blast gives nearby objects a bounded spin',
  );
  assert.equal(
    neighbour.rotation,
    0,
    'blast changes spin without snapping the angle',
  );
  assert.equal(source.spin, 0);
  neighbour.spin = 0.7;
  explode({ object: source, radius: 20, impulse: 8 });
  assert(
    Math.abs(neighbour.spin - 0.7 - spin) < 1e-12,
    'blast spin is seeded and additive',
  );
  neighbour.spin = 0;
  neighbour.position.x = 15;
  explode({ object: source, radius: 20, impulse: 8 });
  assert.equal(neighbour.spin, spin / 2, 'spin fades with distance');
  for (const maxSpeed of [0.1, 24]) {
    const spins = [3, 30, 300].map((mass) => {
      neighbour.mass = mass;
      neighbour.radius = 8;
      neighbour.spin = 0;
      explode({ object: source, radius: 20, impulse: 2400, maxSpeed });
      return neighbour.spin;
    });
    assert(
      Math.abs(spins[0]) > 0.65 && Math.abs(spins[0]) <= 1.3,
      'light items get a stronger spin than the old one-radian cap at this falloff',
    );
    assert(
      Math.abs(spins[1] * 10 - spins[0]) < 1e-12,
      'ten times the mass receives one tenth the spin',
    );
    assert(
      Math.abs(spins[2] * 100 - spins[0]) < 1e-12,
      'heavy chunks receive much less spin even when linear speed is capped',
    );
  }
  for (const properties of [
    { position: Vec.create(30, 0) },
    { buried: true },
    { dead: true },
  ]) {
    const excluded = addEntity(
      blastWorld,
      new GameObject({ id: 3, ...properties }),
    );
    explode({ object: source, radius: 20, impulse: 8 });
    assert.equal(
      excluded.spin,
      0,
      'distant, buried and dead objects do not spin',
    );
  }
}

// Fading projectiles expire silently; other projectiles keep their expiry effects.
for (const id of ['autogun', 'plasmaAccelerator']) {
  const expiryWorld = createWorld();
  const shot = addEntity(
    expiryWorld,
    new Projectile(id, { id: 1, health: 0.001, position: Vec.create(5, 6) }),
  );
  const neighbour = addEntity(
    expiryWorld,
    new GameObject({ id: 2, position: Vec.create(10, 6), mass: 1 }),
  );
  const events = [];
  updateEntities({ world: expiryWorld, events, tick: 7 });
  assert(shot.dead);
  const deathEvents = events.filter(
    (event) => event.type === 'objectDestroyed',
  );
  const fading = !!moduleSpecs[id].projectile.fadeOut;
  assert.equal(deathEvents.length, fading ? 0 : 1);
  if (!fading) assert.equal(deathEvents[0].objectId, shot.id);
  assert.equal(events.filter((event) => event.type === 'explosion').length, fading ? 0 : 1);
  sparks.length = effects.length = 0;
  presentEvents({ events });
  assert.equal(effects.length, fading ? 0 : 1, 'only non-fading expiry presents effects');
  assert.equal(sparks.length, 0, 'expiry never adds sparks to fading or dedicated effects');
  if (!fading) assert.equal(
    events.find((event) => event.type === 'explosion').effect,
    moduleSpecs[id].projectile.effect || moduleSpecs[id].projectile.explosion.effect,
    'expiry uses the configured visual effect',
  );
  if (id === 'autogun') assert.equal(Vec.length(neighbour.velocity), 0);
  else assert(neighbour.velocity.x > 0, 'plasma expiry retains its blast');
  events.length = 0;
  updateEntities({ world: expiryWorld, events, tick: 8 });
  assert.equal(
    events.length,
    0,
    'removed projectiles do not repeat their death event',
  );
}

// Only specs opting into a physical blast scan and push nearby objects.
for (const id of ['plasmaAccelerator', 'autogun'])
  for (const trigger of ['hit', 'expiry', 'cleanup']) {
    const blastWorld = createWorld();
    const target = addEntity(
      blastWorld,
      new GameObject({
        id: 1,
        position: Vec.create(20, 0),
        radius: 5,
        health: 100,
      }),
    );
    const light = addEntity(
      blastWorld,
      new GameObject({
        id: 2,
        position: Vec.create(13, 10),
        radius: 1,
        mass: 1,
        health: 100,
      }),
    );
    const heavy = addEntity(
      blastWorld,
      new GameObject({
        id: 3,
        position: Vec.create(13, 10),
        radius: 1,
        mass: 1000,
        health: 100,
      }),
    );
    const below = addEntity(
      blastWorld,
      new GameObject({
        id: 4,
        position: Vec.create(13, -10),
        radius: 1,
        mass: 1,
        health: 100,
      }),
    );
    const far = addEntity(
      blastWorld,
      new GameObject({
        id: 5,
        position: Vec.create(13, 50),
        radius: 1,
        mass: 1,
        health: 100,
      }),
    );
    const buried = addEntity(
      blastWorld,
      new GameObject({
        id: 6,
        position: Vec.create(13, -8),
        radius: 1,
        mass: 1,
        health: 100,
        buried: true,
      }),
    );
    const otherShot = addEntity(
      blastWorld,
      new Projectile(id, { id: 7, position: Vec.create(13, 12) }),
    );
    const shot = addEntity(
      blastWorld,
      new Projectile(id, {
        id: 8,
        position: Vec.create(trigger === 'hit' ? -80 : 13, 0),
        velocity: Vec.create(trigger === 'hit' ? 600 : 0, 0),
      }),
    );
    const spec = moduleSpecs[id];
    assert.equal(shot.health, spec.damage);
    const blastEvents = [];
    if (trigger === 'hit') {
      shot.update(0.3);
      shot.resolveHits(blastEvents, blastWorld, 0.3);
      assert.equal(target.health, 100 - spec.damage);
    } else if (trigger === 'expiry') {
      shot.update(spec.projectile.lifetime / 1000 - 0.001);
      assert(!shot.dead, 'projectiles retain their configured lifespan');
      updateEntities({
        world: blastWorld,
        entities: [shot],
        events: blastEvents,
        dt: 0.002,
        tick: 7,
      });
      assert.equal(
        target.health,
        100 - (spec.projectile.explosion?.damage || 0),
        'only plasma expiry damages nearby objects',
      );
    } else shot.remove();
    assert(
      shot.dead && !blastWorld.entities.has(shot.id),
      'death removes the projectile from the world',
    );
    if (trigger === 'cleanup' || !spec.projectile.explosion) {
      assert.equal(
        Vec.length(light.velocity),
        0,
        'visual-only effects and replication cleanup do not apply a blast',
      );
      assert.equal(
        Vec.length(below.velocity),
        0,
        'simple projectiles do not push nearby objects',
      );
      assert.equal(
        Vec.length(otherShot.velocity),
        0,
        'simple projectiles do not push other projectiles',
      );
      assert.equal(
        light.health,
        100,
        'autogun and cleanup do not deal splash damage',
      );
      continue;
    }
    assert(
      light.velocity.y > 0 && below.velocity.y < 0,
      'unhit objects are pushed radially away from the projectile',
    );
    assert(
      light.velocity.y > heavy.velocity.y && heavy.velocity.y > 0,
      'massive fragments receive a smaller push, while lighter objects respect the configured speed cap',
    );
    assert(
      Vec.length(light.velocity) <= spec.projectile.explosion.maxSpeed,
      'the blast caps the added speed for light objects',
    );
    assert(otherShot.velocity.y > 0, 'nearby projectiles can also be pushed');
    assert.equal(
      light.health,
      100 - spec.projectile.explosion.damage,
      'plasma damages nearby objects it did not hit',
    );
    assert.equal(heavy.health, light.health, 'damage is independent of mass');
    assert.equal(below.health, light.health);
    assert(
      blastEvents.some(
        (event) =>
          event.type === 'collision' &&
          event.b === light.id &&
          event.damage[1] > 0,
      ),
      'splash damage emits target-colour sparks',
    );
    assert.equal(far.health, 100);
    assert.equal(buried.health, 100);
    assert.equal(
      Vec.length(far.velocity),
      0,
      'objects outside the blast remain still',
    );
    assert.equal(
      Vec.length(buried.velocity),
      0,
      'buried contents stay inside their asteroid',
    );
    const velocity = Vec.clone(light.velocity);
    shot.resolveHits(blastEvents, blastWorld, 0.3);
    shot.update(0.1);
    assert.deepEqual(
      light.velocity,
      velocity,
      'an expired projectile does not explode again',
    );
  }
{
  const blastWorld = createWorld();
  const outline = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ];
  const asteroid = addEntity(
    blastWorld,
    new Asteroid({
      id: 1,
      contents: [2],
      health: 5,
      maxHealth: 5,
      radius: 15,
      mass: 10,
      position: Vec.create(),
      shapeOutline: outline,
    }),
  );
  const shot = addEntity(
    blastWorld,
    new Projectile('plasmaAccelerator', {
      id: 2,
      position: Vec.create(-80, 0),
      velocity: Vec.create(600, 0),
    }),
  );
  shot.update(0.3);
  shot.resolveHits([], blastWorld, 0.3);
  const released = [...blastWorld.entities.values()].find(
    (entity) => entity instanceof Item,
  );
  assert(
    asteroid.dead && released,
    'destroying the asteroid releases its resource',
  );
  assert(
    released.velocity.x > 0,
    'resources created by the hit are pushed by the same explosion',
  );
}

// Real item and asteroid masses must retain the kick after movement updates.
for (const id of ['plasmaAccelerator', 'autogun']) {
  const blastWorld = createWorld();
  const item = addEntity(
    blastWorld,
    new Item(gold, { id: 1, position: Vec.create(15, 18) }),
  );
  const rocks = [62.5, 300].map((mass, index) =>
    addEntity(
      blastWorld,
      new Asteroid({
        id: index + 2,
        contents: [],
        health: 100,
        maxHealth: 100,
        radius: 10,
        mass,
        position: Vec.create(15, index ? -15 : 15),
        shapeOutline: [
          [-8, -8],
          [8, -8],
          [8, 8],
          [-8, 8],
        ],
      }),
    ),
  );
  const targets = [item, ...rocks];
  const starts = targets.map((target) => Vec.clone(target.position));
  const shot = addEntity(
    blastWorld,
    new Projectile(id, { id: 4, health: 0.001, position: Vec.create() }),
  );
  updateEntities({ world: blastWorld, entities: [shot], tick: 7, events: [] });
  assert(shot.dead);
  for (const target of targets) {
    assert(
      Vec.length(target.velocity) <=
        (moduleSpecs[id].projectile.explosion?.maxSpeed || 0),
      'a blast respects its speed cap',
    );
    for (let tick = 0; tick < 30; tick++) target.update(1 / 30);
  }
  targets.forEach((target, index) => {
    const distance = Vec.distance(target.position, starts[index]);
    if (id === 'plasmaAccelerator') {
      assert(
        distance > 1,
        'items and small asteroid chunks keep moving after a plasma blast',
      );
      assert(
        Vec.dot(Vec.subtract(target.position, starts[index]), starts[index]) >
          0,
        'movement is away from the explosion',
      );
    } else
      assert.equal(
        distance,
        0,
        'autogun expiry leaves nearby items and chunks stationary',
      );
  });
}

// Area damage follows actual polygons, and all broken pieces detach together.
{
  const blastWorld = createWorld();
  const source = addEntity(
    blastWorld,
    new GameObject({ id: 1, velocity: Vec.create(1, 0) }),
  );
  const segments = [-10, 10, 50].map((x) => ({
    contents: [],
    health: 5,
    maxHealth: 20,
    mass: 10,
    shapeOutline: [
      [x, -10],
      [x + 20, -10],
      [x + 20, 10],
      [x, 10],
    ],
  }));
  const rock = addEntity(
    blastWorld,
    new Asteroid({
      id: 2,
      contents: [],
      health: 100,
      maxHealth: 100,
      radius: 80,
      mass: 30,
      position: Vec.create(),
      segments,
    }),
  );
  const events = [];
  explode({ object: source, radius: 24, impulse: 12, damage: 10, events });
  assert(rock.dead, 'the blast splits the damaged asteroid');
  assert.deepEqual(
    rock.segments.map((segment) => segment.health),
    [-5, -5, 5],
    'only segments whose polygons intersect the blast take damage',
  );
  const children = [...blastWorld.entities.values()].filter(
    (entity) => entity instanceof Asteroid,
  );
  assert.equal(
    children.length,
    3,
    'both broken segments detach in one fracture',
  );
  assert(
    children.every(
      (child) =>
        child.health > 0 &&
        !child.segments?.some((segment) => segment.health < 1),
    ),
    'new chunks receive no second damage or unresolved broken segments',
  );
  assert.equal(
    events.filter((event) => event.type === 'asteroidSplit').length,
    1,
  );
  assert.equal(events.filter((event) => event.type === 'collision').length, 2);
  assert(
    children
      .filter((child) => child.position.x < 30)
      .every((child) => Vec.length(child.velocity) > 0),
    'new nearby chunks receive the radial push',
  );
}
{
  const blastWorld = createWorld();
  const source = addEntity(
    blastWorld,
    new GameObject({ id: 1, position: Vec.create(30, 20) }),
  );
  const craft = addEntity(
    blastWorld,
    new Craft({
      world: blastWorld,
      id: 2,
      radius: 100,
      hullSegments: [
        {
          health: 100,
          points: [
            [-2, -2],
            [2, -2],
            [2, 2],
            [-2, 2],
          ],
          mounts: [[{ x: 20, y: 20, fits: ['plasmaAccelerator'] }]],
        },
      ],
    }),
  );
  const gun = new PlasmaAccelerator();
  craft.fit(gun);
  craft.setModuleActive({ module: PlasmaAccelerator, active: true });
  const events = [];
  explode({ object: source, radius: 24, impulse: 0, damage: 3, events });
  assert.equal(
    gun.mount.health,
    gun.healthActivated - 3,
    'overlapping model parts share one damage application to the module mount',
  );
  assert.equal(
    craft.segments.find((segment) => segment.hull).health,
    100,
    'a nearby bounding circle does not make a distant hull take splash damage',
  );
  assert.equal(events.filter((event) => event.type === 'collision').length, 1);
  const shot = addEntity(
    blastWorld,
    new Projectile('plasmaAccelerator', {
      id: 3,
      position: Vec.create(80, 19),
      velocity: Vec.create(-600, 0),
    }),
  );
  const health = gun.mount.health;
  shot.update(0.1);
  shot.resolveHits(events, blastWorld, 0.1);
  assert(shot.dead);
  assert.equal(
    gun.mount.health,
    health - moduleSpecs.plasmaAccelerator.damage,
    'the direct plasma hit excludes the whole fitted module from repeated splash damage',
  );
}

const fills = [];
const halos = [];
let gradients = 0;
const beamLines = [];
const beamStarts = [];
const beamWidths = [];
const beamDrawOrder = [];
game.ctx = {
  save() {},
  restore() {},
  translate() {},
  rotate() {},
  beginPath() {},
  moveTo(x, y) { beamStarts.push([x, y]); },
  lineTo(x, y) { beamLines.push([x, y]); },
  arc() {},
  stroke(path) { if (!path) { beamDrawOrder.push('beam'); beamWidths.push(this.lineWidth); } },
  fill(path) {
    beamDrawOrder.push(path ? 'model' : 'glow');
    fills.push(this.fillStyle);
  },
  createRadialGradient(...coordinates) {
    gradients++;
    const gradient = {
      stops: [],
      addColorStop(offset, color) {
        this.stops.push([offset, color]);
      },
    };
    halos.push({ coordinates, gradient });
    return gradient;
  },
};
game.scale = 1;
// Synthetic beam presentation follows spec colour, range and first impact.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 9 }));
  const beamEffect = {
    startFraction: 0.25,
    muzzleOffset: 2,
    pulseDuration: 80,
    pulseScale: 0.2,
    layers: [{ lineWidth: 5, alpha: 0.2 }, { lineWidth: 1, alpha: 1 }],
    muzzleFlash: [
      { type: 'rays', radius: 3, radiusEven: 1, pointCount: 6, lineWidth: 2 },
      { type: 'glow', radius: 7, alpha: 0.6 },
    ],
    hitMarker: [
      { type: 'rays', radius: 5, radiusEven: 2, pointCount: 4, lineWidth: 1 },
      { type: 'glow', radius: 10, alpha: 0.6 },
    ],
  };
  const laser = new Laser({ beamEffect, shades: ['#111111', '#222222', '#123456', '#444444', '#555555'], reach: 321 });
  ship.fit(laser, ship.mounts.find((mount) => mount.fits.includes(Laser)));
  ship.setModuleActive({ module: Laser, active: true });
  ship.updateModules(1);
  ship.firing = true;
  const parts = ship.segmentsAtMount(laser.mount);
  const before = gradients;
  const beforeModelFills = fills.length;
  const beforeBeamStarts = beamStarts.length;
  const beforeBeamWidths = beamWidths.length;
  const beforeBeamLines = beamLines.length;
  parts.forEach((segment) => laser.render({ segment, craft: ship }));
  const originalModelFills = fills.slice(beforeModelFills).filter((color) => typeof color === 'string');
  assert.equal(gradients - before, 1, 'one muzzle glow per fitted laser');
  assert.deepEqual(beamStarts[beforeBeamStarts], [laser.barrelLength * beamEffect.startFraction, 0], 'beam origin follows the effect spec');
  assert.deepEqual(beamWidths.slice(beforeBeamWidths), [5, 1, 2], 'beam and flare widths follow their effect layers');
  assert.equal(beamLines.length - beforeBeamLines, 2 + 6, 'the effect chooses its beam layers and muzzle ray count');
  assert.equal(halos.at(-1).coordinates[5], 7, 'muzzle glow uses its configured radius');
  assert.equal(beamLines[beforeBeamLines + 2][0], laser.barrelLength + beamEffect.muzzleOffset + 3, 'muzzle rays use their configured radius');
  assert(Math.abs(beamLines[beforeBeamLines + 3][1] - Math.sin(Math.PI / 3)) < 1e-8, 'alternating rays use their configured inner radius');
  assert.equal(beamDrawOrder.at(-1), 'glow', 'the muzzle glow renders above the entire model');
  assert(beamDrawOrder.indexOf('beam') < beamDrawOrder.lastIndexOf('model'), 'the cap covers the beam');
  assert(beamDrawOrder.lastIndexOf('model') < beamDrawOrder.lastIndexOf('beam'), 'the muzzle flare strokes render above the cap');
  assert.equal(halos.at(-1).coordinates[0], laser.barrelLength + beamEffect.muzzleOffset, 'the muzzle flare uses its configured offset');
  assert.equal(halos.at(-1).gradient.stops[0][1], '#12345699', 'beam effects use the configured colour');
  assert(beamLines.some(([x, y]) => x === laser.barrelLength + 321 && y === 0), 'unobstructed beams end at their configured range');
  const target = addEntity(world, new GameObject({ world, position: Vec.create(150, laser.mount.localPosition.y), radius: 10, health: 100 }));
  const beforeHit = gradients;
  const length = laser.trace(ship).length;
  parts.forEach((segment) => laser.render({ segment, craft: ship }));
  assert.equal(gradients - beforeHit, 2, 'a hit adds a glow at the contact');
  assert.equal(halos.at(-1).coordinates[5], 10, 'hit glow uses its configured radius');
  assert.equal(halos.at(-1).coordinates[0], laser.barrelLength + length, 'hit marker follows the traced endpoint');
  world.tick = 1;
  const beforePulseWidths = beamWidths.length;
  parts.forEach((segment) => laser.render({ segment, craft: ship }));
  const expectedPulse = 1 + beamEffect.pulseScale * Math.sin(simulationStep * 1000 * Math.PI * 2 / beamEffect.pulseDuration);
  assert(Math.abs(beamWidths[beforePulseWidths] - 5 * expectedPulse) < 1e-8, 'beam pulse uses the configured duration and scale');
  world.tick = 0;
  const afterHit = gradients;
  ship.firing = false;
  const beforeIdle = beamLines.length;
  parts.forEach((segment) => laser.render({ segment, craft: ship }));
  assert.equal(beamLines.length, beforeIdle, 'release removes the beam from both model openings and the world');
  assert.equal(gradients, afterHit, 'release removes muzzle and impact effects immediately');
  laser.resolveHits(ship, 1, []);
  assert.equal(target.health, 100, 'released lasers do not damage targets');
  ship.setModuleActive({ module: Laser, active: false });
  const beforeInactive = beamLines.length;
  parts.forEach((segment) => laser.render({ segment, craft: ship }));
  assert.equal(beamLines.length, beforeInactive, 'inactive lasers do not show a beam');
  assert.equal(target.health, 100, 'rendering does not apply damage');
  ship.setModuleActive({ module: Laser, active: true });
  ship.updateModules(laser.activationDuration);
  ship.firing = true;

  for (const shades of [colors.red, colors.yellow, colors.cyan]) {
    assert(ship.applyDockAction({ action: 'paint', moduleId: laser.id, paint: paintColors.indexOf(shades) }, { credits: 1000 }), 'laser paint actions succeed');
    // Replication and save restoration use the same module palette state.
    ship.moduleStates = ship.moduleStates.map((state) => ({ ...state, shades: state.shades?.slice() }));
    const beforePaintFills = fills.length;
    ship.segmentsAtMount(laser.mount).forEach((segment) => laser.render({ segment, craft: ship }));
    assert.deepEqual(fills.slice(beforePaintFills).filter((color) => typeof color === 'string'), originalModelFills, 'painting and restoring a laser preserves its explicit model colours');
    const expectedGlow = withAlpha({ color: shades[2], alpha: 0.6 });
    assert.equal(halos.at(-2).gradient.stops[0][1], expectedGlow, 'muzzle glow follows the laser paint');
    assert.equal(halos.at(-1).gradient.stops[0][1], expectedGlow, 'impact glow follows the laser paint');
    assert.equal(laser.shades, shades, 'restored laser paint uses the canonical palette');
  }

  const binding = moduleBinding('laserActive');
  const press = (type) => window.dispatchEvent(Object.assign(new Event(type), { key: binding.keys[0], repeat: false }));
  press('keydown');
  press('keyup');
  assert.equal(playerInput.laserActive, true, 'laser key toggles activation');
  press('keydown');
  press('keyup');
  assert.equal(playerInput.laserActive, false, 'laser key toggles back off');
}
// Muzzle flashes observe successful shots outside replayable mechanics.
for (const Type of [Autogun, PlasmaAccelerator]) {
  effects.length = 0;
  const flashWorld = createWorld();
  const flashShip = addEntity(
    flashWorld,
    createPlayerShip(flashWorld, {
      playerId: 11,
      position: Vec.create(30, 40),
      rotation: Math.PI / 2,
    }),
  );
  flashWorld.players.set(11, { id: 11, shipId: flashShip.id });
  const gun = new Type({
    muzzleFlash: [{ type: 'glow', color: '#ff0', duration: 50, radius: 6 }],
  });
  flashShip.fit(gun, flashShip.mounts.find((mount) => mount.fits.includes(Type)));
  flashShip.cargoContents.push(new Item(autogunAmmunition));
  flashShip.setModuleActive({ module: Type, active: true });
  flashShip.updateModules(gun.activationDuration + gun.chargeDuration);
  flashShip.firing = true;
  flashShip.updateVisual(0);
  assert.equal(effects.length, 0, 'idle weapons do not flash');
  const checkpoint = captureWorld({ world: flashWorld });
  flashShip.fireWeapons(0);
  assert.equal(effects.length, 0, 'firing mechanics do not create visual effects');
  flashShip.updateVisual(0);
  assert.equal(effects.length, 1, 'each weapon flashes after a successful shot');
  assert.equal(effects[0].parent, flashShip, 'the burst follows its ship');
  assert.equal(effects[0].rotation, 0, 'the burst faces along the weapon in ship coordinates');
  assert.deepEqual(
    effects[0].position,
    Vec.add(gun.mount.localPosition, Vec.create(gun.barrelLength, 0)),
    'the flash originates at the muzzle in ship coordinates',
  );
  flashShip.updateVisual(0);
  assert.equal(effects.length, 1, 'repeated visual updates do not repeat the shot');
  flashShip.updateVisual(gun.fireInterval * 2);
  assert.equal(effects.length, 1, 'a delayed display frame cannot invent another shot');
  restoreWorld({ world: flashWorld, state: checkpoint });
  assert.equal(gun.fireCooldown, 0, 'rollback restores the cooldown before the shot');
  flashWorld.nextEntityId += 10;
  flashShip.fireWeapons(0);
  flashShip.updateVisual(0);
  assert.equal(effects.length, 1, 'replaying a shot with a different projectile ID does not duplicate its flash');
  gun.fireCooldown -= 0.01;
  flashShip.updateVisual(0);
  gun.fireCooldown += 0.01;
  flashShip.updateVisual(0);
  assert.equal(effects.length, 1, 'small cooldown corrections do not flash');
  gun.fireCooldown = 0;
  flashShip.updateVisual(0);
  gun.fireCooldown = gun.fireInterval;
  flashShip.updateVisual(0);
  assert.equal(effects.length, 1, 'a large snapshot cooldown correction cannot repeat a local shot');
  flashWorld.tick += gun.fireInterval / simulationStep;
  flashShip.fireWeapons(gun.fireInterval);
  flashShip.updateVisual(gun.fireInterval);
  assert.equal(effects.length, 2, 'a shot still flashes when a frame spans a whole interval');
  flashWorld.tick += (gun.fireInterval - 0.01) / simulationStep;
  flashShip.fireWeapons(gun.fireInterval - 0.01);
  flashShip.updateVisual(0);
  flashWorld.tick += 0.01 / simulationStep;
  flashShip.fireWeapons(0.01);
  flashShip.updateVisual(0);
  assert.equal(effects.length, 3, 'the next observed shot flashes again');
  flashShip.setModuleActive({ module: Type, active: false });
  flashWorld.tick += gun.fireInterval / simulationStep;
  flashShip.fireWeapons(gun.fireInterval);
  flashShip.updateVisual(0);
  assert.equal(effects.length, 3, 'cooling down without firing does not flash');
  const spare = new Type();
  spare.fireCooldown = spare.fireInterval;
  flashShip.cargoContents.push(spare);
  flashShip.updateVisual(0);
  assert.equal(effects.length, 3, 'weapons in cargo do not flash');
  if (Type === Autogun) {
    flashShip.cargoContents.length = 0;
    flashShip.setModuleActive({ module: Type, active: true });
  flashShip.updateModules(gun.activationDuration + gun.chargeDuration);
  flashShip.firing = true;
    flashShip.fireWeapons(0);
    flashShip.updateVisual(0);
    assert.equal(effects.length, 3, 'an empty autogun does not flash');
  }
  const remoteGun = new Type({ muzzleFlash: gun.muzzleFlash });
  remoteGun.mount = gun.mount;
  remoteGun.fireCooldown = remoteGun.fireInterval;
  remoteGun.updateVisual({ craft: flashShip, segments: [], dt: 0 });
  assert.equal(effects.length, 4, 'remote cooldown resets still present a flash');
  remoteGun.updateVisual({ craft: flashShip, segments: [], dt: remoteGun.fireInterval });
  assert.equal(effects.length, 4, 'a delayed display frame cannot repeat a remote flash');
}
effects.length = 0;
const rechargeWorld = createWorld();
const chargingShip = addEntity(
  rechargeWorld,
  createPlayerShip(rechargeWorld, { playerId: 3 }),
);
rechargeWorld.players.set(3, { id: 3, shipId: chargingShip.id });
const chargingGun = new PlasmaAccelerator({ shades: colors.cyan });
chargingShip.fit(
  chargingGun,
  chargingShip.mounts.find((mount) => mount.fits.includes(PlasmaAccelerator)),
);
const indicators = chargingShip.segments.filter(
  (segment) =>
    segment.module === chargingGun && segment.rechargeDelay !== undefined && segment.color === colors.violet[2],
);
assert.equal(indicators.length, 3);
const backing = chargingShip.segments.find(
  (segment) => segment.module === chargingGun && segment.color === colors.violet[0],
);
chargingGun.render({ segment: backing, craft: chargingShip });
assert.equal(
  fills.at(-1),
  colors.cyan[0],
  'the backing uses the darkest module palette shade',
);
assert.equal(
  chargingShip.segmentsAtMount(chargingGun.mount)[0],
  backing,
  'the dark rectangle draws behind the barrel and indicators',
);

const glowCount = () => {
  const previous = gradients;
  chargingShip.render({ zIndex: renderingLayers.glowBelowShips });
  return gradients - previous;
};
assert.equal(glowCount(), 0, 'retracted indicators do not glow');
chargingShip.setModuleActive({ module: PlasmaAccelerator, active: true });
chargingShip.updateModules(chargingGun.activationDuration / 2);
assert.equal(glowCount(), 0, 'indicators remain dark while deploying');
chargingShip.updateModules(chargingGun.activationDuration / 2);
assert.equal(glowCount(), 0, 'fully deployed plasma starts uncharged');
chargingShip.updateVisual(0);
assert.equal(effects.length, 0, 'startup charge does not create a muzzle flash');
chargingShip.updateModules(0.5);
assert.equal(glowCount(), 1, 'plasma charges its first indicator only after deployment');
chargingShip.updateModules(chargingGun.chargeDuration - 0.501);
assert.equal(glowCount(), 3, 'the barrel stays dark just before startup charging completes');
chargingShip.updateModules(0.001);
assert.equal(glowCount(), 4, 'fully charged plasma adds a barrel glow without holding fire');
assert(
  halos
    .slice(-3)
    .every(
      (halo, index) => halo.coordinates[5] === indicators[index].glow.radius,
    ),
  'each indicator halo uses its configured glow radius',
);
assert(
  halos.slice(-3).every((halo) => halo.gradient.stops[0][1] === colors.cyan[2]),
  'indicator halos follow the module paint',
);
assert(
  halos
    .slice(-3)
    .every((halo) => halo.gradient.stops.at(-1)[1] === '#00000000'),
  'the configured indicator glow keeps its original transparent edge',
);

const indicatorColors = () => {
  indicators.forEach((segment) =>
    chargingGun.render({ segment, craft: chargingShip }),
  );
  return fills.slice(-3);
};
const plasmaShots = () =>
  [...rechargeWorld.entities.values()].filter(
    (entity) => entity instanceof Projectile,
  ).length;
assert.deepEqual(
  indicatorColors(),
  [colors.cyan[2], colors.cyan[2], colors.cyan[2]],
  'a ready weapon has three bright indicators in its paint colour',
);
controlShip(chargingShip, { ...playerInput, fire: true }, []);
chargingShip.fireWeapons(0);
assert.deepEqual(
  indicatorColors(),
  [colors.cyan[0], colors.cyan[0], colors.cyan[0]],
  'firing darkens all three indicators',
);
assert.equal(glowCount(), 0, 'discharged indicators have no glow');
for (let index = 0; index < 3; index++) {
  chargingShip.fireWeapons(0.499);
  assert.equal(
    plasmaShots(),
    1,
    'cannot fire before the configured recharge completes',
  );
  assert.deepEqual(
    indicatorColors(),
    indicators.map((_, i) => colors.cyan[i < index ? 2 : 0]),
    'indicators stay dark until their recharge boundary',
  );
  if (index === 2)
    controlShip(chargingShip, { ...playerInput, fire: false }, []);
  chargingShip.fireWeapons(0.001);
  assert.deepEqual(
    indicatorColors(),
    indicators.map((_, i) => colors.cyan[i <= index ? 2 : 0]),
    'one indicator recharges every half second',
  );
  assert.equal(
    glowCount(),
    index + 1,
    'each recharge restores only its indicator glow',
  );
}
chargingShip.fireWeapons(chargingGun.fireInterval - 1.5);
assert.equal(glowCount(), 4, 'the barrel glow returns only when the full firing cooldown completes');
controlShip(chargingShip, { ...playerInput, fire: true }, []);
chargingShip.fireWeapons(0);
assert.equal(
  plasmaShots(),
  2,
  'can fire again when the configured cooldown completes',
);
assert.deepEqual(
  indicatorColors(),
  [colors.cyan[0], colors.cyan[0], colors.cyan[0]],
  'each shot restarts the recharge sequence',
);

// The same spec settings work on another weapon, with different colours and glow.
const genericShip = addEntity(
  rechargeWorld,
  createPlayerShip(rechargeWorld, { playerId: 4 }),
);
const genericGun = new Autogun({
  shades: colors.green,
  model: [
    {
      ...Autogun.model[0],
      color: colors.green[1],
      rechargeDelay: 0.1,
      rechargeColor: colors.green[0],
      glow: {
        offset: [3, 2],
        radius: 7,
        alpha: 0.4,
        stops: [
          [0, colors.green[1]],
          [1, '#000', 0],
        ],
      },
    },
  ],
});
genericShip.fit(
  genericGun,
  genericShip.mounts.find((mount) => mount.fits.includes(Autogun)),
);
genericShip.setModuleActive({ module: Autogun, active: true });
genericShip.updateModules(genericGun.activationDuration + genericGun.chargeDuration);
const genericPart = genericShip.segmentsAtMount(genericGun.mount)[0];
genericGun.fireCooldown = 0.25;
genericGun.render({ segment: genericPart });
assert.equal(
  fills.at(-1),
  colors.green[0],
  'any weapon uses its configured recharge colour',
);
const beforeGenericGlow = gradients;
genericGun.renderGlow({ segment: genericPart });
assert.equal(
  gradients,
  beforeGenericGlow,
  'any weapon suppresses its configured glow until the part recharges',
);
genericGun.fireCooldown = 0.15;
genericGun.render({ segment: genericPart });
assert.equal(
  fills.at(-1),
  colors.green[1],
  'any weapon restores its configured charged colour',
);
genericGun.renderGlow({ segment: genericPart });
assert.equal(gradients, beforeGenericGlow + 1);
assert.equal(
  halos.at(-1).coordinates[5],
  7,
  'the glow radius comes from the model part',
);
for (const side of [-1, 1]) {
  genericGun.mount.localPosition.y = side * Math.abs(genericGun.mount.localPosition.y);
  const points = genericPart.points(genericPart);
  const middle = points.reduce(
    ([x, y], point) => [x + point[0] / points.length, y + point[1] / points.length],
    [0, 0],
  );
  genericGun.renderGlow({ segment: genericPart });
  assert.deepEqual(
    halos.at(-1).coordinates.slice(0, 2),
    [middle[0] + 3, middle[1] + side * 2],
    'glow offsets follow the weapon geometry on either mount side',
  );
}
assert.equal(
  game.ctx.globalAlpha,
  0.4,
  'the glow opacity comes from the model part',
);
assert.deepEqual(
  halos.at(-1).gradient.stops,
  [
    [0, colors.green[1]],
    [1, '#00000000'],
  ],
  'gradient stops accept paint shades and literal colours from the spec',
);
genericPart.rechargeDelay = undefined;
genericGun.fireCooldown = 0.25;
genericGun.renderGlow({ segment: genericPart });
assert.equal(
  gradients,
  beforeGenericGlow + 4,
  'a glow without a recharge setting stays visible during firing',
);

for (const y of [-29, 29]) {
  chargingGun.mount.localPosition.y = y;
  const side = Math.sign(y);
  const barrel = chargingShip.segments.find(
    (segment) =>
      segment.module === chargingGun &&
      segment.rechargeDelay === undefined &&
      segment.color === colors.violet[2],
  );
  assert.deepEqual(
    barrel.points(barrel).slice(3, 7),
    [
      [12, 3 * side],
      [10.5, 0.5 * side],
      [1, 0.5 * side],
      [1, 3 * side],
    ],
    'the cutout faces away from the ship centre',
  );
  assert(
    indicators.every((segment) =>
      segment
        .points(segment)
        .every(
          ([x, localY]) =>
            x >= 1 && x < 12 && localY * side > 0.5 && localY * side <= 3,
        ),
    ),
    'all recharge rectangles stay inside the cutout',
  );
}
for (const Type of [PlasmaAccelerator, Autogun])
  for (const side of [-1, 1]) {
    const collisionWorld = createWorld();
    const craft = addEntity(
      collisionWorld,
      new Craft({
        world: collisionWorld,
        id: 1,
        radius: 100,
        hullSegments: [
          {
            health: 100,
            points: [
              [-2, -2],
              [2, -2],
              [2, 2],
              [-2, 2],
            ],
            mounts: [[{ x: 20, y: side * 20, fits: [Type.definitionId] }]],
          },
        ],
      }),
    );
    const gun = new Type();
    craft.fit(gun);
    craft.setModuleActive({ module: Type, active: true });
    craft.segmentsAtMount(gun.mount).forEach((segment) => { segment.activationProgress = 1; });
    const first = craft.segmentsAtMount(gun.mount)[0];
    const firstPoints =
      typeof first.points === 'function' ? first.points(first) : first.points;
    assert.equal(
      firstPoints[0][1],
      moduleSpecs[gun.definitionId].model[0].points[0][1] * side,
      'ordinary barrel and backing parts mirror along with recharge indicators',
    );
    const colliders = craft
      .hitbox(true)
      .filter((collider) => collider.segment.module === gun);
    assert(
      colliders.length > 0,
      'both weapon barrels have physical colliders on either side of the ship',
    );
    assert(
      colliders.every((collider) => collider.physics && collider.radius > 0),
      'mirrored weapon parts have collision bounds',
    );
    const atBarrel = Vec.add(gun.mount.localPosition, Vec.create(15, -1));
    assert(
      colliders.some((collider) =>
        contactBetween(collider, { position: atBarrel, radius: 1 }),
      ),
      'an object touching the exposed barrel collides with its visible geometry',
    );
    const projectile = addEntity(
      collisionWorld,
      new Projectile('autogun', {
        world: collisionWorld,
        id: 2,
        playerId: 2,
        position: Vec.add(gun.mount.localPosition, Vec.create(60, -1)),
        velocity: Vec.create(-600, 0),
      }),
    );
    const health = gun.mount.health;
    projectile.captureSweep();
    projectile.update(0.1);
    projectile.resolveHits([], collisionWorld, 0.1);
    assert(
      projectile.dead && gun.mount.health < health,
      'projectiles strike the weapon barrel rather than passing through it',
    );
  }
// Synthetic visuals test both projectile types without fixing their production colours.
for (const id of ['plasmaAccelerator', 'autogun']) {
  const custom = moduleSpecs[id].projectile;
  const original = { ...custom };
  Object.assign(custom, {
    radius: 3,
    lifetime: 4000,
    color: colors.yellow[2],
    glow: { color: colors.green[2], alpha: 0.3, radius: 30 },
  });
  const customShot = new Projectile(id);
  assert.equal(customShot.radius, 3);
  assert.equal(customShot.health, moduleSpecs[id].damage);
  const beforeGlow = gradients;
  customShot.render();
  assert.equal(
    gradients,
    beforeGlow + 1,
    'either projectile type renders its configured glow',
  );
  assert.equal(
    fills.at(-1),
    colors.yellow[2],
    'the solid circle keeps its own colour',
  );
  assert.deepEqual(
    fills.at(-2).stops,
    [
      [0, '#33ff774d'],
      [1, '#00000000'],
    ],
    'the glow combines its own colour and numeric opacity before fading to transparent',
  );
  assert.equal(
    halos.at(-1).coordinates[5],
    30,
    'glow size is independent of projectile radius',
  );
  delete custom.glow;
  const beforeNoGlow = gradients;
  customShot.render();
  assert.equal(gradients, beforeNoGlow, 'omitting glow disables it');
  assert.equal(
    fills.at(-1),
    colors.yellow[2],
    'unglowing projectiles retain their configured colour',
  );
  custom.fadeOut = 400;
  for (const [remaining, alpha] of [[0.8, 1], [0.4, 1], [0.2, 0.5], [0, 0]]) {
    customShot.health = moduleSpecs[id].damage * remaining / (custom.lifetime / 1000);
    custom.glow = original.glow;
    game.ctx.globalAlpha = 0.6;
    const drawAlphas = [];
    const fill = game.ctx.fill;
    game.ctx.fill = function() { drawAlphas.push(this.globalAlpha); };
    customShot.render();
    game.ctx.fill = fill;
    assert.deepEqual(drawAlphas, [0.6 * alpha, 0.6 * alpha], 'round and glow fade together over the configured duration');
  }
  delete custom.fadeOut;
  Object.assign(custom, original);
}
for (const delay of [1, 3, 8]) {
  effects.length = 0;
  const server = createWorld();
  const serverShip = addEntity(
    server,
    createPlayerShip(server, { id: 1, playerId: 1 }),
  );
  serverShip.fit(
    new Autogun(),
    serverShip.mounts.find((m) => m.fits.includes(Autogun)),
  );
  serverShip.setModuleActive({ module: Autogun, active: true });
  serverShip.updateModules(3);
  serverShip.cargoContents.push(new Item(autogunAmmunition));
  const ammunition = serverShip.cargoContents.find((item) => item.resource === 5);
  const initialRounds = ammunition.rounds;
  addPlayer(server, { id: 1, shipId: serverShip.id });
  addEntity(
    server,
    new Asteroid({
      id: 100,
      position: Vec.create(150, -25),
      velocity: Vec.create(),
      radius: 50,
      mass: 1000,
      health: 100,
      maxHealth: 100,
      contents: [],
      spin: 0,
    }),
  );
  const client = createWorld();
  server.entities.forEach((entity) =>
    addEntity(client, cloneEntity({ entity })),
  );
  addPlayer(client, { id: 1, shipId: 1 });
  const prediction = new PredictionManager({ world: client });
  prediction.setLocalPlayer({ playerId: 1 });
  const packets = [];
  const emitted = [];
  for (let tick = 0; tick < 160; tick++) {
    const input = { ...playerInput, plasmaActive: true, autogunActive: true, fire: tick < 130 };
    emitted.push(...prediction.step({ input, send() {} }));
    updateWorld({ world: server, inputs: new Map([[1, input]]) });
    packets.push({
      tick: server.tick,
      nextEntityId: server.nextEntityId,
      entities: [...server.entities.values()].map((entity) =>
        cloneEntity({ entity }),
      ),
    });
    const packet = packets[tick - delay];
    if (packet) prediction.reconcile(packet);
    client.entities.get(1).updateVisual(1 / 60);
    if (tick % 21 === 0) {
      const beforePause = effects.length;
      client.entities.get(1).updateVisual(0.15);
      assert.equal(effects.length, beforePause, 'display pauses cannot duplicate flashes during live prediction');
    }
    assert.equal(
      client.entities.has(100),
      server.entities.has(100),
      'delayed snapshots must not resurrect an asteroid after its predicted split',
    );
    assert.deepEqual(
      [...client.entities.values()]
        .filter((e) => e instanceof Asteroid)
        .map((e) => e.id),
      [...server.entities.values()]
        .filter((e) => e instanceof Asteroid)
        .map((e) => e.id),
      'predicted chunks retain their identities across older snapshots',
    );
    prediction.predictFrame({ elapsed: 1 / 120 });
  }
  assert.equal(
    effects.length,
    initialRounds - ammunition.rounds,
    'each authoritative round produces exactly one local flash across delayed snapshots and frame prediction',
  );
  assert.equal(
    emitted.filter((e) => e.type === 'asteroidSplit' && e.asteroidId === 100)
      .length,
    1,
    'a split is presented once, even across delayed reconciliation',
  );
}
// An authoritative shot may reuse the ID of a different predicted shot.
{
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { id: 1, playerId: 1 }),
  );
  addPlayer(world, { id: 1, shipId: ship.id });
  const shot = addEntity(
    world,
    new Projectile('autogun', {
      world,
      id: 100,
      playerId: 1,
      position: Vec.create(500, 0),
      velocity: Vec.create(200, 0),
    }),
  );
  const reported = cloneEntity({ entity: shot });
  reported.definitionId = 'plasmaAccelerator';
  reported.playerId = 2;
  reported.health = 0.75;
  const prediction = new PredictionManager({ world });
  prediction.setLocalPlayer({ playerId: 1 });
  prediction.step({ input: playerInput, send() {} });
  prediction.reconcile({
    tick: 0,
    entities: [cloneEntity({ entity: ship }), reported],
  });
  assert.equal(
    shot.definitionId,
    'plasmaAccelerator',
    'the server corrects a reused projectile ID to its real weapon',
  );
  assert.equal(
    shot.playerId,
    2,
    'the server corrects the owner used to exclude friendly hits',
  );
  assert(
    Math.abs(
      shot.health -
        (0.75 -
          moduleSpecs.plasmaAccelerator.damage /
            (moduleSpecs.plasmaAccelerator.projectile.lifetime / 1000) /
            30),
    ) < 1e-8,
    'remaining projectile health is corrected before replay',
  );
  const saved = captureWorld({ world });
  shot.definitionId = 'autogun';
  shot.playerId = 1;
  restoreWorld({ world, state: saved });
  assert.equal(
    shot.definitionId,
    'plasmaAccelerator',
    'rollback retains the corrected projectile weapon',
  );
  assert.equal(
    shot.playerId,
    2,
    'rollback retains the corrected projectile owner',
  );
}
const account = { credits: 4 };
const bought = ship.applyDockAction({ action: 'buyAmmo' }, account);
assert(bought && account.credits === 2);
assert.equal(ship.cargoContents.at(-1).resource, 5);
assert.equal(
  ship.cargoContents.at(-1).rounds,
  200,
  'purchased packs contain 200 rounds',
);
assert(
  ship.cargoContents.at(-1).id > 0,
  'purchased cargo must have a positive entity ID',
);
ship.cargoContents.length = ship.cargoSpace;
assert.equal(
  ship.applyDockAction({ action: 'buyAmmo' }, account),
  undefined,
  'full cargo blocks buying ammo',
);
console.log(
  'Weapon controls, cadence, ammunition, CCD, chunk damage, replication and rendering passed',
);
`;

const entryId = `${root}/src/__weapons_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'weapons-test',
        resolveId: (id) => (id === entryId ? entryId : undefined),
        load(id: string) {
          if (id === entryId) {
            return production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : scenario;
          }

          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return 'export const unlockAudio=()=>{};export const playSound=()=>{};export const updateThrusterSound=()=>{};';
          }
        },
      },
      buildPrePlugin(),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
