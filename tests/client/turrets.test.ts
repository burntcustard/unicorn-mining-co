import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { stripIfdef } from '../../plugins/replace-pre-terser';
import { testBuildPlugin } from '../support/build-plugin';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { createPlayerShip } from '${root}/src/client/objects/create-ship.ts';
import { createWorld, addEntity } from '${root}/src/client/simulation/world.ts';
import { updateWorld } from '${root}/src/client/simulation/update-world.ts';
import { controlShip } from '${root}/src/client/objects/control-ship.ts';
import { Autogun, AutogunTurret, PlasmaAcceleratorTurret, Laser, LaserTurret, ShieldGenerator, moduleTypes } from '${root}/src/client/objects/modules/index.ts';
import { Weapon } from '${root}/src/client/objects/modules/weapon.ts';
import { Asteroid } from '${root}/src/client/objects/asteroid.ts';
import { GameObject } from '${root}/src/client/objects/game-object.ts';
import { Projectile } from '${root}/src/client/objects/projectile.ts';
import { Item } from '${root}/src/client/objects/item.ts';
import { autogunAmmo } from '${root}/src/specs/items/index.ts';
import { moduleIds, moduleSpecs, stationModuleIds } from '${root}/src/specs/modules/index.ts';
import { fitsOf } from '${root}/src/client/ui/docked-model.ts';
import { moduleRowsOf } from '${root}/src/client/ui/controls.ts';
import { playerInput } from '${root}/src/client/input/input.ts';
import { EntityState } from '${root}/src/client/simulation/entity-state.ts';
import { FramePrediction } from '${root}/src/client/prediction/frame-prediction.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';
import { effects } from '${root}/src/client/effects/effect.ts';
import { game } from '${root}/src/client/game.ts';
import { colors } from '${root}/src/specs/colors.ts';
import { renderingLayers } from '${root}/src/specs/rendering-layers.ts';
import { moduleSpecForSimulation } from '${root}/src/client/utilities/module-spec.ts';
import { rotatePoint } from '${root}/src/client/utilities/geometry.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';

globalThis.Path2D = class {
  moveTo() {}
  lineTo() {}
  closePath() {}
  arc() {}
};
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, message);
const pointClose = (actual, expected, message) => {
  close(actual.x, expected.x, message);
  close(actual.y, expected.y, message);
};
const fixture = (Type, properties = {}, shipProperties = {}) => {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1, ...shipProperties }));
  world.players.set(1, { id: 1, shipId: ship.id });
  const mount = ship.mounts.find(mount => mount.fits.includes(Type));
  const gun = new Type(properties);
  ship.fit(gun, mount);
  return { world, ship, gun, mount };
};
const activate = (ship, gun) => {
  ship.setModuleActive({ module: gun.constructor, active: true });
  ship.updateModules(gun.activationDuration + (gun.chargeDuration ?? 0));
};
const projectiles = world => [...world.entities.values()].filter(entity => entity instanceof Projectile);

// Every turret is a purchasable choice on the Mustang's shield mount.
for (const Type of [AutogunTurret, PlasmaAcceleratorTurret, LaserTurret]) {
  const world = createWorld();
  const ship = createPlayerShip(world, { playerId: 1 });
  const mount = ship.mounts.find(mount => mount.fits.includes(ShieldGenerator));
  assert(mount.fits.includes(Type), 'shield mount accepts every turret family');
  assert(fitsOf(ship, mount).includes(Type), 'outfitting offers the turret on its compatible empty mount');
  assert(stationModuleIds.includes(Type.definitionId));
  assert.equal(moduleTypes[moduleIds.indexOf(Type.definitionId)], Type, 'catalog IDs reconstruct the correct runtime class');
  const gun = new Type();
  ship.fit(gun, mount);
  assert.equal(mount.module, gun);
  assert(ship.segmentsAtMount(mount)[0].turretBase, 'the circular support draws before the weapon');
}

// Targeting uses the mount's world position and preserves a disabled bearing.
for (const Type of [AutogunTurret, PlasmaAcceleratorTurret, LaserTurret]) {
  const { world, ship, gun, mount } = fixture(Type, {}, { position: Vec.create(40, -30), rotation: 0.7 });
  const localToWorld = point => Vec.add(ship.position, rotatePoint(point, ship.rotation));
  const asteroid = addEntity(world, new Asteroid({ world, contents: [], radius: 12, position: localToWorld(Vec.add(mount.localPosition, Vec.create(0, 150))) }));
  const enemy = addEntity(world, createPlayerShip(world, { playerId: 2, position: localToWorld(Vec.add(mount.localPosition, Vec.create(-150, 0))) }));
  controlShip(ship, { ...playerInput, targetId: asteroid.id, autogunActive: true, plasmaActive: true, laserActive: true }, []);
  ship.updateModules(gun.activationDuration + (gun.chargeDuration ?? 0));
  gun.turretTurnRate = 1;
  ship.updateTurrets(0);
  close(gun.aimRotation, 0, 'changing targets cannot rotate a turret without elapsed time');
  ship.updateTurrets(0.25);
  close(gun.aimRotation, 0.25, 'a turret turns at its configured maximum rate');
  ship.updateTurrets(0.25);
  close(gun.aimRotation, 0.5, 'successive updates continue turning toward the target');
  ship.updateTurrets(2);
  close(gun.aimRotation, Math.PI / 2, 'an active turret aims from the mount toward an asteroid');
  const parts = ship.segmentsAtMount(mount);
  const base = parts.find(part => part.turretBase);
  const baseRadius = base.radius(base);
  assert(baseRadius > 0 && !base.points, 'the turret support remains a circle');
  const authored = moduleSpecs[Type.definitionId].model.filter(part => !part.turretBase);
  parts.filter(part => !part.turretBase).forEach((part, index) => {
    part.points(part).forEach(([x, y], point) => {
      const [originalX, originalY] = authored[index].points[point];
      pointClose(Vec.create(x, y), Vec.create(-originalY, originalX), 'the deployed weapon model follows its aiming angle');
    });
  });
  ship.targetId = enemy.id;
  ship.updateTurrets(0.25);
  const held = Math.PI / 2 + 0.25;
  close(gun.aimRotation, held, 'switching to a different target turns at the maximum rate');
  ship.setModuleActive({ module: Type, active: false });
  ship.updateTurrets(2);
  close(gun.aimRotation, held, 'disabled turrets retain their angle when the target changes');
  ship.targetId = undefined;
  ship.updateTurrets(2);
  close(gun.aimRotation, held, 'clearing the target cannot turn a disabled turret');
  activate(ship, gun);
  ship.updateTurrets(0.25);
  close(gun.aimRotation, held - 0.25, 'clearing the target returns forward at the maximum rate');
  ship.updateTurrets(2);
  close(gun.aimRotation, 0, 'active turrets face forward without a target');
  ship.targetId = enemy.id;
  ship.updateTurrets(4);
  close(Math.abs(gun.aimRotation), Math.PI, 'active turrets track enemy ships behind the mount');
  assert.equal(base.radius(base), baseRadius, 'aiming never changes the support circle');
  world.players.clear();
  ship.targetId = undefined;
  ship.update(0);
  close(Math.abs(gun.aimRotation), Math.PI, 'remote movement preserves replicated turret aim without another player target input');
}

// Turning crosses the angle boundary by the shortest path and stops at the target.
{
  const { world, ship, gun, mount } = fixture(AutogunTurret);
  activate(ship, gun);
  gun.turretTurnRate = 1;
  const targetAngle = -Math.PI + 0.1;
  const target = addEntity(world, new GameObject({ world,
    position: Vec.add(mount.localPosition, rotatePoint(Vec.create(150, 0), targetAngle)),
  }));
  ship.targetId = target.id;
  gun.aimRotation = Math.PI - 0.1;
  ship.updateTurrets(0.05);
  close(gun.aimRotation, Math.PI - 0.05, 'angle wrapping takes the short turn across the boundary');
  ship.updateTurrets(0.2);
  close(gun.aimRotation, targetAngle, 'a turret stops on the target without overshooting');
  gun.aimRotation = 0;
  target.position = Vec.add(mount.localPosition, Vec.create(0, 150));
  ship.targetId = target.id;
  ship.updateTurrets(0.3);
  const singleStep = gun.aimRotation;
  gun.aimRotation = 0;
  for (let step = 0; step < 3; step++) ship.updateTurrets(0.1);
  close(gun.aimRotation, singleStep, 'turn speed is independent of simulation step size');
}

// Fixed and turret kinetic weapons consume the same cargo rounds.
{
  const { world, ship, gun } = fixture(AutogunTurret);
  const fixed = new Autogun();
  ship.fit(fixed, ship.mounts.find(mount => mount.fits.includes(Autogun)));
  const ammo = new Item(autogunAmmo, { rounds: 3 });
  ship.cargoContents.push(ammo);
  controlShip(ship, { ...playerInput, autogunActive: true, fire: true }, []);
  ship.updateModules(Math.max(gun.activationDuration + (gun.chargeDuration ?? 0), fixed.activationDuration + fixed.chargeDuration));
  ship.fireWeapons(0);
  assert.equal(projectiles(world).length, 2, 'both weapon forms fire from one ammunition pack');
  assert.equal(ammo.rounds, 1);
  const rows = moduleRowsOf(ship).filter(row => row.Type === AutogunTurret || row.Type === Autogun);
  assert.equal(rows.length, 2, 'each weapon type has a HUD control');
  assert(rows.every(row => row.name.endsWith('(1)')), 'fixed and turret HUD rows show the same remaining ammo pool');
  gun.fireCooldown = 0;
  fixed.fireCooldown = 0;
  ship.fireWeapons(0);
  assert.equal(projectiles(world).length, 3, 'the final shared round allows only one more shot');
  assert(!ship.cargoContents.includes(ammo), 'the empty shared ammunition pack is removed');
}

// Muzzle flashes and replay state follow the turret heading.
{
  effects.length = 0;
  const { world, ship, gun, mount } = fixture(AutogunTurret, {
    muzzleFlash: [{ type: 'glow', color: '#ff0', duration: 50, radius: 6 }],
  }, { position: Vec.create(30, 40), rotation: 0.4 });
  ship.cargoContents.push(new Item(autogunAmmo));
  activate(ship, gun);
  gun.aimRotation = 0.8;
  ship.firing = true;
  const worldMuzzle = () => Vec.add(ship.position, rotatePoint(
    Vec.add(mount.localPosition, rotatePoint(Vec.create(gun.barrelLength + gun.projectile.radius + 1, 0), gun.aimRotation)),
    ship.rotation,
  ));
  const localMuzzle = () => Vec.add(mount.localPosition, rotatePoint(Vec.create(gun.barrelLength, 0), gun.aimRotation));
  ship.fireWeapons(0);
  const first = projectiles(world).at(-1);
  pointClose(first.position, worldMuzzle(), 'the first projectile starts at the rotated barrel');
  pointClose(first.velocity, rotatePoint(Vec.create(gun.projectile.speed, 0), ship.rotation + gun.aimRotation), 'projectile velocity follows ship and turret rotation');
  ship.updateVisual(0);
  assert.equal(effects.length, 1);
  pointClose(effects[0].position, localMuzzle(), 'the flash follows the barrel that fired');
  close(effects[0].rotation, gun.aimRotation, 'muzzle effects follow turret heading');
  const checkpoint = new EntityState(ship);
  const states = ship.moduleStates;
  const recorded = states.find(state => state.id === gun.id);
  assert.equal(recorded.aimRotation, gun.aimRotation);
  world.tick += 120;
  ship.fireWeapons(gun.fireInterval);
  assert.equal(projectiles(world).length, 2, 'the turret retains one projectile per firing interval');
  pointClose(projectiles(world).at(-1).position, worldMuzzle(), 'the next shot uses the same aimed muzzle');
  ship.updateVisual(0);
  assert.equal(effects.length, 2);
  pointClose(effects[1].position, localMuzzle(), 'the next flash keeps its aimed muzzle');
  gun.aimRotation = -1;
  checkpoint.restore();
  close(gun.aimRotation, recorded.aimRotation, 'rollback restores turret heading');
  gun.aimRotation = -2;
  ship.moduleStates = states;
  close(gun.aimRotation, recorded.aimRotation, 'snapshot updates restore an existing module heading');
  ship.fit(0, mount);
  ship.moduleStates = states;
  const reconstructed = mount.module;
  assert(reconstructed instanceof AutogunTurret);
  close(reconstructed.aimRotation, recorded.aimRotation, 'snapshot reconstruction restores heading');
  effects.length = 0;
}

// Autogun spin remains in weapon coordinates when its turret turns.
{
  const { ship, gun, mount } = fixture(AutogunTurret);
  activate(ship, gun);
  const parts = ship.segmentsAtMount(mount);
  const barrels = parts.filter(part => !part.turretBase);
  const originalRender = Weapon.prototype.render;
  const rendered = [];
  Weapon.prototype.render = ({ segment, points }) => {
    if (points) rendered.push(points);
  };
  try {
    barrels.forEach(part => { part.phase = 0.3; });
    const draw = angle => {
      rendered.length = 0;
      gun.aimRotation = angle;
      parts.forEach(segment => gun.render({ segment }));
      return rendered.map(points => points.map(([x, y]) => rotatePoint(Vec.create(x, y), -angle)));
    };
    const forward = draw(0);
    const sideways = draw(0.9);
    assert.equal(forward.length, 4, 'the autogun still animates all four spinning barrels');
    sideways.forEach((points, index) => points.forEach((point, at) => pointClose(point, forward[index][at], 'turret aiming preserves barrel spin geometry')));
    const phase = barrels[0].phase;
    gun.updateVisual({ craft: ship, segments: parts, dt: 0.01 });
    assert(barrels[0].phase !== phase, 'charged autogun turret continues spinning');
  } finally {
    Weapon.prototype.render = originalRender;
  }
}

// A synthetic charged indicator tests rotated offsets on the upper glow layer.
{
  const spec = moduleSpecForSimulation({ ...moduleSpecs.plasmaAcceleratorTurret, model: [{
    outline: false,
    points: [[2, 1], [8, 1], [8, 5], [2, 5]],
    glow: { offset: [3, 4], radius: 5, alpha: 0.5, stops: [[0, colors.violet[2]], [1, colors.black[0], 0]] },
  }] });
  const { ship, gun } = fixture(PlasmaAcceleratorTurret, { ...spec, model: PlasmaAcceleratorTurret.createModel(spec) });
  activate(ship, gun);
  gun.aimRotation = Math.PI / 2;
  const gradients = [];
  const context = game.ctx;
  game.ctx = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, arc() {}, fill() {},
    createRadialGradient(...coordinates) { gradients.push(coordinates); return { addColorStop() {} }; },
  };
  try {
    ship.render({ zIndex: renderingLayers.glowAboveShips });
    assert.equal(gradients.length, 1, 'turret indicator glow renders above the hull');
    pointClose(Vec.create(gradients[0][0], gradients[0][1]), Vec.create(-7, 8), 'indicator center and authored glow offset rotate together');
    gun.chargeCooldown = gun.chargeDuration;
    const part = ship.segmentsAtMount(gun.mount)[0];
    part.rechargeDelay = gun.fireInterval;
    ship.render({ zIndex: renderingLayers.glowAboveShips });
    assert.equal(gradients.length, 1, 'an uncharged indicator stays dark');
  } finally {
    game.ctx = context;
  }
}

// Beam traces and damage originate at the turret's rotated muzzle.
{
  const { world, ship, gun, mount } = fixture(LaserTurret, {}, { position: Vec.create(30, 40), rotation: 0.3 });
  const target = addEntity(world, new GameObject({ world, health: 100, radius: 10,
    position: Vec.add(ship.position, rotatePoint(Vec.add(mount.localPosition, Vec.create(0, 150)), ship.rotation)),
  }));
  ship.targetId = target.id;
  activate(ship, gun);
  ship.updateTurrets(2);
  ship.firing = true;
  const trace = gun.trace(ship);
  assert.equal(trace.first?.owner, target, 'the aimed beam hits a target off the ship forward axis');
  const events = [];
  ship.resolveLasers(0.1, events);
  assert(target.health < 100, 'the aimed beam deals its regular damage');
  assert.equal(events.length, 1);
  const muzzle = Vec.add(ship.position, rotatePoint(Vec.add(mount.localPosition, Vec.create(0, gun.barrelLength + trace.length)), ship.rotation));
  pointClose(events[0].position, muzzle, 'beam hit effects use the aimed beam endpoint');
}
// Turret bearings share the hull's display-time interpolation while moving.
for (const Type of [AutogunTurret, PlasmaAcceleratorTurret, LaserTurret]) {
  const { world, ship, gun, mount } = fixture(Type);
  const target = addEntity(world, new Asteroid({ world, contents: [], radius: 30,
    position: Vec.create(400, 200),
  }));
  activate(ship, gun);
  ship.targetId = target.id;
  ship.updateTurrets(10);
  ship.spin = 1;
  ship.velocity = Vec.create(25, -15);
  const prediction = new FramePrediction();
  const input = { ...emptyPlayerInput(), autogunActive: true, plasmaActive: true, laserActive: true, targetId: target.id };
  const frame = { input, changes: [] };
  for (let tick = 0; tick < 12; tick++) {
    const liveAim = gun.aimRotation;
    const endpoint = prediction.sample({ world, playerId: 1, input: frame, elapsed: simulationStep });
    const end = endpoint.entities.get(ship.id).modules.find(module => module.id === gun.id).aimRotation;
    const turn = Math.atan2(Math.sin(end - liveAim), Math.cos(end - liveAim));
    for (const fraction of [0, 0.1, 0.4, 0.8, 1, 0.4, 1]) {
      const sampled = prediction.sample({ world, playerId: 1, input: frame, elapsed: simulationStep * fraction });
      const rendered = sampled.entities.get(ship.id);
      const turret = rendered.modules.find(module => module.id === gun.id);
      const position = Vec.add(rendered.position, rotatePoint(mount.localPosition, rendered.rotation));
      const desired = Math.atan2(target.position.y - position.y, target.position.x - position.x);
      const error = desired - rendered.rotation - turret.aimRotation;
      assert(Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < 0.005,
        'a tracking turret stays near the target throughout a turning hull display tick');
      close(turret.aimRotation, liveAim + turn * fraction,
        'turret motion advances at display rate and resampling never jumps to the tick endpoint');
      close(gun.aimRotation, liveAim, 'sampling turret aim leaves simulation state unchanged');
    }
    updateWorld({ world, inputs: new Map([[1, input]]) });
  }
}
// Display sampling takes the short turn across PI and holds inactive turrets.
for (const active of [false, true]) {
  const { world, ship, gun } = fixture(AutogunTurret);
  activate(ship, gun);
  const target = addEntity(world, new GameObject({ world, position: Vec.create(-300, -100) }));
  gun.aimRotation = Math.PI - 0.02;
  const start = gun.aimRotation;
  const input = { ...emptyPlayerInput(), autogunActive: active, targetId: target.id };
  const prediction = new FramePrediction();
  for (const fraction of [0.1, 0.5, 1, 0.25, 1, 0]) {
    const sampled = prediction.sample({ world, playerId: 1, input: { input, changes: [] }, elapsed: simulationStep * fraction });
    const aim = sampled.entities.get(ship.id).modules.find(module => module.id === gun.id).aimRotation;
    const turn = Math.atan2(Math.sin(aim - start), Math.cos(aim - start));
    close(turn, active ? gun.turretTurnRate * simulationStep * fraction : 0,
      'display aim respects the maximum turn rate across angle wrapping and keeps disabled turrets still');
  }
}
// Continuously firing while circling a selected asteroid used to cycle forever
// in the convex hull of a nearly collinear, rotated laser body.
for (const Type of [Laser, LaserTurret]) {
  const { world, ship, gun } = fixture(Type);
  const prediction = new FramePrediction();
  activate(ship, gun);
  for (let index = 0; index < 3; index++) {
    addEntity(world, new Asteroid({ world, id: 1010 + index, contents: [0, 1],
      radius: 70 + index * 20, health: 15, maxHealth: 15, mass: 100,
      position: Vec.create(index * 220, 0),
    }));
  }
  let hits = 0;
  for (let tick = 0; tick < 180; tick++) {
    const target = [...world.entities.values()].find(entity => entity instanceof Asteroid && !entity.dead);
    assert(target, 'the flight fixture retains a target');
    const angle = tick * 0.011;
    ship.position = Vec.add(target.position, Vec.create(Math.cos(angle) * 240, Math.sin(angle) * 240));
    ship.rotation = angle + Math.PI;
    ship.velocity = Vec.create(-Math.sin(angle) * 15, Math.cos(angle) * 15);
    const input = { ...emptyPlayerInput(), laserActive: true, fire: true, targetId: target.id };
    const frame = { input, changes: [] };
    const health = [target.health, target.segments?.map(segment => segment.health)];
    for (const fraction of [0.15, 0.5, 0.9, 1]) {
      prediction.sample({ world, playerId: 1, input: frame, elapsed: simulationStep * fraction });
    }
    assert.deepEqual([target.health, target.segments?.map(segment => segment.health)], health, 'beam prediction leaves the live asteroid unchanged');
    hits += updateWorld({ world, inputs: new Map([[1, input]]) }).filter(event => event.type === 'laserDamage').length;
    world.tick++;
  }
  assert(hits > 0, 'the flight fixture fires damaging beams throughout prediction');
}
console.log('Turret fitting, aiming, models, shared ammo, replay state, animation, glow, flashes, beams, and targeted flight passed');
`;

const entryId = `${root}/src/__turrets_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'turrets-test',
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
            return 'export const unlockAudio=()=>{};export const playSound=()=>{};';
          }
        },
      },
      buildPrePlugin(),
      ...(production ? [testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        output[0].code + '\n//# sourceURL=turrets-' + production + '.js',
      ).toString('base64')
  );
}
