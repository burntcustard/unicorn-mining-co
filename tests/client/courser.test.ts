import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { stripIfdef } from '../../plugins/replace-pre-terser';
import { testBuildPlugin } from '../support/build-plugin';

const scenario = `
import assert from 'node:assert/strict';
import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { createWorld, addEntity } from '${process.cwd()}/src/client/simulation/world.ts';
import { updateWorld } from '${process.cwd()}/src/client/simulation/update-world.ts';
import { controlShip, moduleControls } from '${process.cwd()}/src/client/objects/control-ship.ts';
import { CannonSm, CargoHatch, CargoHatchPair, ShieldGeneratorXs, moduleTypes, thrusters } from '${process.cwd()}/src/client/objects/modules/index.ts';
import { Projectile } from '${process.cwd()}/src/client/objects/projectile.ts';
import { damage } from '${process.cwd()}/src/client/objects/damage.ts';
import { Station } from '${process.cwd()}/src/client/objects/station.ts';
import { Item } from '${process.cwd()}/src/client/objects/item.ts';
import { amethyst, autogunAmmo, diamond, gold, opal } from '${process.cwd()}/src/specs/items/index.ts';
import { moduleSpecs } from '${process.cwd()}/src/specs/modules/index.ts';
import { fitsOf } from '${process.cwd()}/src/client/ui/docked-model.ts';
import { moduleRowsOf } from '${process.cwd()}/src/client/ui/controls.ts';
import { playerInput } from '${process.cwd()}/src/client/input/input.ts';
import { EntityState } from '${process.cwd()}/src/client/simulation/entity-state.ts';
import { outerEdges } from '${process.cwd()}/src/client/utilities/polygon.ts';
import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
import { rotatePoint } from '${process.cwd()}/src/client/utilities/geometry.ts';

const world = createWorld();
for (const shipType of ['courser', 'crotus']) {
  const rejoining = createPlayerShip(world, { shipType, playerId: 1 });
  controlShip(rejoining, { ...playerInput, autogunActive: true }, []);
  const restoredInput = { ...playerInput };
  moduleControls.forEach(({ Type, writeInput }) => writeInput({ input: restoredInput, active: rejoining.moduleActive({ module: Type }) }));
  assert(restoredInput.autogunActive, 'reconnection preserves the shared kinetic weapon toggle');
}
const ship = addEntity(world, createPlayerShip(world, { shipType: 'courser', playerId: 1 }));
assert.equal(ship.cargoSpace,8);
const hullOutlines = ship.hullSegments.map(segment => segment.points.map(point => [...point]));
assert.equal(outerEdges(hullOutlines).length, 1, 'all Courser hull segments stay connected through shared edges');
world.players.set(1, { id: 1, shipId: ship.id });
const guns = ship.mounts.filter(mount => mount.module instanceof CannonSm);
const hatch = ship.mounts.find(mount => mount.module instanceof CargoHatchPair);
const shieldMount = ship.mounts.find(mount => mount.fits.includes(ShieldGeneratorXs));
assert(shieldMount && !shieldMount.module, 'Courser starts with an empty XS shield mount');
assert.equal(shieldMount.localPosition.y, 0);
assert.equal(shieldMount.hull.module, ship.cockpit.module, 'shield mount belongs to the central core');
assert.equal(guns.length, 2);
assert.deepEqual(guns.map(mount => mount.localPosition.y), [-8, 8], 'cargo collection preserves the cannon positions');
assert(hatch.module instanceof CargoHatch, 'paired hatches use normal cargo controls and collection');
assert.equal(hatch.localPosition.y, 0);
assert.deepEqual(ship.mounts.flatMap(mount => mount.fits.filter(Type => thrusters.includes(Type))).map(Type => Type.definitionId), ['thrusterSingleSm']);
assert.equal(ship.engine.definitionId, 'thrusterSingleSm', 'Courser starts with its compatible small thruster');
assert.equal(ship.engine.mount.hull.module,ship.hullSegments[2], 'thruster is mounted to the rear rectangular hull segment');

const ammo = new Item(autogunAmmo);
ship.cargoContents.push(ammo);
controlShip(ship, { ...playerInput, autogunActive: true, cargoHatch: true, fire: true }, []);
ship.updateModules(1);
assert(ship.moduleActive({ module: CannonSm }));
assert(ship.moduleActive({ module: CargoHatch }));
assert.equal(moduleRowsOf(ship).filter(row => row.Type === CannonSm).length, 1);
const shots = () => [...world.entities.values()].filter(entity => entity instanceof Projectile);
const rounds = ammo.rounds;
ship.fireWeapons(0);
for (let tick = 0; tick < 119; tick++) ship.fireWeapons(1 / 120);
assert.equal(shots().length, 2, 'each cannon fires only once within a second');
ship.fireWeapons(1 / 120);
assert.equal(shots().length, 4, 'both cannons fire again one second later');
assert.equal(ammo.rounds, rounds - 4);
assert(shots().every(shot => shot.radius === moduleSpecs.autogun.projectile.radius && shot.health === moduleSpecs.autogun.damage));
assert(shots().every(shot => shot.velocity.x === moduleSpecs.autogun.projectile.speed && shot.velocity.y === 0));
const checkpoint = new EntityState(ship);
controlShip(ship, { ...playerInput, autogunActive: false, fire: true }, []);
ship.fireWeapons(1);
assert.equal(shots().length, 4, 'the autogun toggle disables the cannons');
checkpoint.restore();
assert(ship.moduleActive({ module: CannonSm }));

const doors = ship.segmentsAtMount(hatch).filter(segment => !segment.catches);
assert.equal(doors.length, 2);
const center = (a, b) => a.map((value, index) => (value + b[index]) / 2);
for (const progress of [0, 0.5, 1]) {
  doors.forEach((door, index) => {
    door.activationProgress = progress;
    const points = door.points(door);
    const hinge = center(points[0], points[3]);
    const tip = center(points[1], points[2]);
    const side = index === 0 ? -1 : 1;
    assert.deepEqual(hinge, [0, side * 8], 'outer hinges remain fixed throughout opening');
    assert(Math.abs(Math.hypot(tip[0] - hinge[0], tip[1] - hinge[1]) - 8) < 1e-9);
    if (progress === 0) assert.deepEqual(tip, [0, 0], 'closed doors meet in the middle');
    if (progress === 1) {
      assert(Math.abs(tip[0] - 8) < 1e-9);
      assert(Math.abs(tip[1] - side * 8) < 1e-9, 'doors open 90 degrees forward');
    }
  });
}
const throat = ship.hitbox().find(collider => collider.segment?.module === hatch.module && collider.segment.catches);
assert(throat && !throat.physics);
const item = addEntity(world, new Item(diamond, { world, position: Vec.clone(throat.position) }));
const pickup = item.hitbox().find(collider => collider.pickupPoint);
const events = [];
hatch.module.collect({ ship, contact: { collider: throat, other: pickup }, events, world });
assert(ship.cargoContents.includes(item), 'paired hatches collect real items');
assert(!world.entities.has(item.id));
assert.equal(events[0].type, 'itemCollected');

for (const heading of [0, Math.PI / 2]) {
  for (const [position, moving, spec] of [
    [Vec.create(35, 0), false, diamond],
    [Vec.create(4, -30), false, diamond],
    [Vec.create(4, 30), false, diamond],
    [Vec.create(-30, 0), false, diamond],
    [Vec.create(15, 12), false, diamond],
    [Vec.create(10, 0), false, diamond],
    [Vec.create(3.8, 0), false, diamond],
    [Vec.create(2.8, 0), false, diamond],
    [Vec.create(70, 0), true, diamond],
    [Vec.create(70, 0), true, gold],
    [Vec.create(70, 0), true, amethyst],
    [Vec.create(70, 0), true, opal],
  ]) {
    const testWorld = createWorld();
    const testShip = addEntity(testWorld, createPlayerShip(testWorld, { shipType: 'courser', playerId: 2, position: Vec.create(100, 200), rotation: heading }));
    controlShip(testShip, { ...playerInput, cargoHatch: true, autogunActive: true }, []);
    testShip.updateModules(1);
    const cargo = addEntity(testWorld, new Item(spec, {
      world: testWorld,
      position: Vec.add(testShip.position, rotatePoint(Vec.add(position, Vec.create(4, 0)), heading)),
      rotation: heading,
      velocity: moving ? rotatePoint(Vec.create(-40, 0), heading) : Vec.create(),
    }));
    for (let tick = 0; tick < (moving ? 150 : 1); tick++) {
      updateWorld({ world: testWorld, inputs: new Map() });
      if (testShip.cargoContents.includes(cargo)) {
        const local = rotatePoint(Vec.subtract(cargo.position, testShip.position), -testShip.rotation);
        assert(moving && local.x <= 6 && local.x >= -1 && Math.abs(local.y) <= 7,
          'cargo must pass behind the hatch doors before collection');
        break;
      }
    }
    assert.equal(testShip.cargoContents.includes(cargo), moving,
      'only cargo traveling between the cannons reaches the open hatch');
  }
}

const station = addEntity(world, new Station({ world }));
ship.dockedTo = station.id;
const player = { credits: 10000 };
assert(fitsOf(ship, shieldMount).includes(ShieldGeneratorXs), 'stations offer the compatible XS shield');
assert(ship.applyDockAction({ action: 'buy', module: moduleTypes.indexOf(ShieldGeneratorXs), mount: ship.mounts.indexOf(shieldMount) }, player));
assert(shieldMount.module instanceof ShieldGeneratorXs, 'purchased XS shield fits the central mount');
ship.fit(0, shieldMount);
player.credits = 10000;
for (const mount of guns) {
  ship.fit(0, mount);
}
ship.cargoContents = ship.cargoContents.filter(object => !(object instanceof CannonSm));
for (const mount of guns) {
  assert.deepEqual(fitsOf(ship, mount), [], 'empty cannon mounts offer no station purchase');
}
const cannon = new CannonSm();
ship.cargoContents.push(cannon);
assert.deepEqual(fitsOf(ship, guns[0]), [cannon], 'owned cannons can still be equipped');
for (const mount of [undefined, ship.mounts.indexOf(guns[0])]) {
  assert.equal(ship.applyDockAction({ action: 'buy', module: moduleTypes.indexOf(CannonSm), mount }, player), undefined);
}
assert.equal(player.credits, 10000);
assert(ship.applyDockAction({ action: 'sell', objectIds: [cannon.id] }, player));
assert(!station.cargoContents.includes(cannon), 'sold cannons never become station stock');
station.cargoContents.push(cannon);
const credits = player.credits;
assert.equal(ship.applyDockAction({ action: 'buyStock', objectIds: [cannon.id] }, player), undefined);
assert.equal(player.credits, credits);

for (const shipType of ['mustang','arrow','crotus','courser']) {
  const testWorld = createWorld();
  const testShip = addEntity(testWorld,createPlayerShip(testWorld,{shipType,playerId:2}));
  const engine = testShip.engine;
  const hull = engine.mount.hull;
  if (shipType === 'mustang' || shipType === 'courser') {
    assert(!hull.core,'the engine hull is not a core');
    assert.equal(testShip.segments.filter(segment=>segment.hull && segment.core).length,1);
    assert.equal(testShip.cockpit.module,testShip.hullSegments[shipType === 'mustang' ? 4 : 3],'the forward core anchors the living ship');
  }
  const nozzle = testShip.segments.find(segment=>segment.module===engine);
  const engineHealth = engine.mount.health;
  damage(hull,hull.health-1);
  testShip.update(0);
  assert.equal(hull.health,1,'the damaged engine hull survives at one HP');
  assert.equal(testShip.engine,engine,'damage to a surviving hull cannot destroy its thruster');
  assert.equal(engine.mount.health,engineHealth,'thruster has no independent damage from hull hits');
  assert(!testShip.stranded);
  damage(nozzle,1);
  assert.equal(hull.health,0,'hits on the thruster damage its supporting hull');
  testShip.update(0);
  assert(!testShip.dead && testShip.stranded,'losing the engine hull leaves a living stranded ship');
  assert(!testShip.modules.includes(engine));
  testShip.segments.filter(segment=>segment.hull&&segment.core).forEach(segment=>damage(segment,10000));
  testShip.update(0);
  assert(testShip.dead && !testShip.stranded,'full destruction ends the stranded state');
}

console.log('Courser controls, cannon cadence, paired hatch collection and station restrictions passed');
`;

const entryId = `${process.cwd()}/src/__courser_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'courser-test',
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
        output[0].code + '\n//# sourceURL=courser-' + production + '.js',
      ).toString('base64')
  );
}
