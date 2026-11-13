import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import {
  PlasmaAccelerator,
  PowerPlant,
  Laser,
} from '../../src/client/objects/modules';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';
import { createWorld } from '../../src/client/simulation/world';
import { installExampleModules } from '../support/example-modules';
import {
  modulePowerMarkup,
  moduleThrusterMarkup,
} from '../../src/client/ui/dom/module-details';

installExampleModules();

const ship = createPlayerShip(createWorld());
const plant = ship.modules.find((module) => module instanceof PowerPlant)!;
const engine = ship.engine;
const system = ship.modules.find(
  (module) => module !== plant && module !== engine,
)!;
const engineDemand = engine.powerActivated;
const systemDemand = engineDemand / 2;
const close = (value: number, expected: number) =>
  assert(Math.abs(value - expected) < 1e-9, `${value} != ${expected}`);

const thrusterDetails = moduleThrusterMarkup(engine, ship.turnRate);

assert.match(thrusterDetails, /Fuel usage<\/span><span>3\.6 L\/min/);
assert.match(
  thrusterDetails,
  /Max speed<\/span><span class="text-color text-lg">272 m\/s/,
);
assert.match(
  thrusterDetails,
  /Turn rate<\/span><span class="text-color text-lg">172°\/s/,
);
assert(
  thrusterDetails.includes(
    `Power use</span><span>${engineDemand.toFixed(1)} MW`,
  ),
);
assert.equal(modulePowerMarkup(engine), '');
assert.match(moduleThrusterMarkup(engine, ship.turnRate / 2), /86°\/s/);
assert.match(
  moduleThrusterMarkup(engine),
  /Turn thrust<\/span><span class="text-color text-lg">16/,
);
assert.doesNotMatch(moduleThrusterMarkup(engine), /°\/s/);
assert.equal(moduleThrusterMarkup(plant, ship.turnRate), '');
assert.match(
  modulePowerMarkup(plant),
  /Storage<\/span><span class="text-color text-lg">64 MJ/,
);

assert.equal(ship.storedPower, ship.powerCapacity, 'new ships start charged');

const plantDraw = () =>
  ship.powerEntries.find(({ module }) => module === plant)!.value;

assert.equal(plant.power, undefined);
assert.equal(plant.powerActivated, undefined);
assert.equal(plantDraw(), 0, 'an inactive plant without idle draw uses zero');
const generation = plant.powerGenerated;

plant.powerGenerated = 0;
assert.equal(
  (modulePowerMarkup(plant).match(/0\.0 MW/g) || []).length,
  2,
  'module details display zero for both missing consumption values',
);
plant.powerGenerated = generation;

for (const module of ship.modules) {
  module.power = module.powerActivated = 0;
}

plant.powerGenerated = engineDemand;
system.power = system.powerActivated = systemDemand;
engine.power = 0;
engine.powerActivated = engineDemand;
ship.storedPower = engineDemand;
ship.fly(0, 0);
assert.equal(
  ship.powerUsage,
  engineDemand + systemDemand,
  'thrusters draw active power while idle',
);
ship.fly(1, 1);
assert.equal(
  ship.powerUsage,
  engineDemand + systemDemand,
  'flight does not change thruster demand',
);
const fullThrust = ship.forwardThrust;
const fullTurn = ship.rotationalThrust;

ship.updatePower(1);
close(ship.storedPower, engineDemand / 2);
assert.equal(ship.thrusterPower, 1);
ship.updatePower(1);
close(ship.storedPower, 0);
ship.updatePower(1);
close(ship.thrusterPower, 0.5);
assert.equal(ship.systemsPower, 1);
close(ship.forwardThrust, fullThrust / 2);
close(ship.rotationalThrust, fullTurn / 2);
assert(
  ship.segments
    .filter((segment) => segment.module === engine)
    .every((segment) => segment.active <= 0.5 + 1e-9),
);
const checkpoint = new EntityState(ship);

ship.storedPower = plant.powerCapacity / 4;
ship.thrusterPower = 1;
checkpoint.restore();
close(ship.storedPower, 0);
close(ship.thrusterPower, 0.5);
const clone = cloneEntity({ entity: ship });

close(clone.storedPower, 0);
close(clone.thrusterPower, 0.5);

ship.storedPower = systemDemand / 2;
ship.updatePower(1);
close(ship.thrusterPower, 0.75);
close(ship.storedPower, 0);
plant.powerGenerated = systemDemand / 2;
ship.updatePower(1);
close(ship.systemsPower, 0.5);
assert.equal(ship.thrusterPower, 0);
plant.powerGenerated = 0;
ship.updatePower(1);
assert.equal(ship.systemsPower, 0);
assert.equal(ship.thrusterPower, 0);
plant.powerGenerated = engineDemand + systemDemand + engineDemand;
ship.updatePower(2);
close(ship.storedPower, engineDemand * 2);
ship.updatePower(plant.powerCapacity / engineDemand);
assert.equal(
  ship.storedPower,
  plant.powerCapacity,
  'storage cannot exceed plant capacity',
);
plant.mount.health = 0;
ship.updatePower(1);
assert.equal(ship.storedPower, 0, 'broken plants lose generation and storage');
assert.equal(ship.powerGeneration, 0);
assert.equal(ship.powerCapacity, 0);
assert.equal(ship.thrusterPower, 0);
console.log(
  'Streaming power storage, supply priorities, thrust and prediction state',
);

const chargingWorld = createWorld();
const chargingShip = createPlayerShip(chargingWorld, { playerId: 1 });

chargingWorld.players.set(1, { id: 1, shipId: chargingShip.id });
const gun = new PlasmaAccelerator();

chargingShip.fit(
  gun,
  chargingShip.mounts.find((mount) => mount.fits.includes(PlasmaAccelerator)),
);
const demand = () =>
  chargingShip.powerEntries.find(({ module }) => module === gun)!.value;

assert.equal(
  demand(),
  gun.power,
  'inactive weapons ignore their pending charge',
);
chargingShip.setModuleActive({ module: PlasmaAccelerator, active: true });
assert.equal(
  demand(),
  gun.powerCharging,
  'activation requests charging power immediately',
);
chargingShip.updateModules(3);
assert.equal(demand(), gun.powerActivated, 'ready weapons use standby power');
chargingShip.firing = true;
chargingShip.fireWeapons(0);
assert.equal(
  demand(),
  gun.powerCharging,
  'shots request charging power during cooldown',
);
chargingShip.firing = false;
chargingShip.fireWeapons(gun.fireInterval);
assert.equal(
  demand(),
  gun.powerActivated,
  'finished reload returns to standby',
);
chargingShip.setModuleActive({ module: PlasmaAccelerator, active: false });
assert.equal(demand(), gun.power, 'retracted weapons return to idle power');

const laser = new Laser();

chargingShip.fit(
  laser,
  chargingShip.mounts.find((mount) => mount.fits.includes(Laser)),
);
const laserDemand = () =>
  chargingShip.powerEntries.find(({ module }) => module === laser)!.value;

chargingShip.firing = true;
assert.equal(laserDemand(), laser.power, 'retracted lasers use idle power');
chargingShip.setModuleActive({ module: Laser, active: true });
assert.equal(
  laserDemand(),
  laser.powerActivated,
  'deployment uses active power',
);
chargingShip.updateModules(1);
assert.equal(
  laserDemand(),
  laser.powerFiring,
  'deployed beams draw firing power',
);
chargingShip.firing = false;
assert.equal(
  laserDemand(),
  laser.powerActivated,
  'release restores standby draw',
);
chargingShip.firing = true;
chargingShip.launching = 1;
assert.equal(
  laserDemand(),
  laser.powerActivated,
  'launching blocks firing draw',
);
chargingShip.launching = 0;
chargingShip.setModuleActive({ module: Laser, active: false });
assert.equal(
  laserDemand(),
  laser.power,
  'retraction stops firing draw immediately',
);
laser.mount.health = 0;
assert(!chargingShip.powerEntries.some(({ module }) => module === laser));
