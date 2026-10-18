import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import {
  PlasmaAccelerator,
  PowerPlant,
} from '../../src/client/objects/modules';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';
import { createWorld } from '../../src/client/simulation/world';
import { installExampleModules } from '../support/example-modules';

installExampleModules();

const ship = createPlayerShip(createWorld());
const plant = ship.modules.find((module) => module instanceof PowerPlant)!;
const engine = ship.engine;
const system = ship.modules.find(
  (module) => module !== plant && module !== engine,
)!;

assert.equal(ship.storedPower, ship.powerCapacity, 'new ships start charged');

for (const module of ship.modules) {
  module.power = module.powerActivated = 0;
}

plant.powerGenerated = 2;
plant.powerCapacity = 64;
system.power = system.powerActivated = 1;
engine.power = 0;
engine.powerActivated = 2;
ship.storedPower = 2;
ship.fly(0, 0);
assert.equal(ship.powerUsage, 3, 'thrusters draw active power while idle');
ship.fly(1, 1);
assert.equal(ship.powerUsage, 3, 'flight does not change thruster demand');
const fullThrust = ship.forwardThrust;
const fullTurn = ship.rotationalThrust;

ship.updatePower(1);
assert.equal(ship.storedPower, 1);
assert.equal(ship.thrusterPower, 1);
ship.updatePower(1);
assert.equal(ship.storedPower, 0);
ship.updatePower(1);
assert.equal(ship.thrusterPower, 0.5, 'systems get priority over thrusters');
assert.equal(ship.systemsPower, 1);
assert.equal(ship.forwardThrust, fullThrust / 2);
assert.equal(ship.rotationalThrust, fullTurn / 2);
assert(
  ship.segments
    .filter((segment) => segment.module === engine)
    .every((segment) => segment.active <= 0.5),
);
const checkpoint = new EntityState(ship);

ship.storedPower = 17;
ship.thrusterPower = 1;
checkpoint.restore();
assert.equal(ship.storedPower, 0);
assert.equal(ship.thrusterPower, 0.5);
const clone = cloneEntity({ entity: ship });

assert.equal(clone.storedPower, 0);
assert.equal(clone.thrusterPower, 0.5);

ship.storedPower = 0.5;
ship.updatePower(1);
assert.equal(
  ship.thrusterPower,
  0.75,
  'remaining storage supports a partial tick',
);
assert.equal(ship.storedPower, 0);
plant.powerGenerated = 0.5;
ship.updatePower(1);
assert.equal(ship.systemsPower, 0.5);
assert.equal(ship.thrusterPower, 0);
plant.powerGenerated = 0;
ship.updatePower(1);
assert.equal(ship.systemsPower, 0);
assert.equal(ship.thrusterPower, 0);
plant.powerGenerated = 5;
ship.updatePower(2);
assert.equal(ship.storedPower, 4, 'surplus MW accumulate MJ over seconds');
ship.updatePower(100);
assert.equal(ship.storedPower, 64, 'storage cannot exceed plant capacity');
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
gun.power = 0.2;
gun.powerActivated = 0.4;
gun.powerCharging = 3.2;
const demand = () =>
  chargingShip.powerEntries.find(({ module }) => module === gun)!.value;

assert.equal(demand(), 0.2, 'inactive weapons ignore their pending charge');
chargingShip.setModuleActive({ module: PlasmaAccelerator, active: true });
assert.equal(demand(), 3.2, 'activation requests charging power immediately');
chargingShip.updateModules(3);
assert.equal(demand(), 0.4, 'ready weapons use standby power');
chargingShip.firing = true;
chargingShip.fireWeapons(0);
assert.equal(demand(), 3.2, 'shots request charging power during cooldown');
chargingShip.firing = false;
chargingShip.fireWeapons(gun.fireInterval);
assert.equal(demand(), 0.4, 'finished reload returns to standby');
chargingShip.setModuleActive({ module: PlasmaAccelerator, active: false });
assert.equal(demand(), 0.2, 'retracted weapons return to idle power');
