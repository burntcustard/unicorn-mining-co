import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { Station } from '../../src/client/objects/station';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import { EntityState } from '../../src/client/simulation/entity-state';
import { moduleTypesById } from '../../src/client/objects/modules';
import { shipSpecsById } from '../../src/specs/ships';
import {
  encodeClientMessage,
  decodeClientMessage,
} from '../../src/client/protocol/binary-control';
import { installExampleModules } from '../support/example-modules';

installExampleModules();

const world = createWorld();
const ship = createPlayerShip(world);
const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const usage = ship.engine.fuelUsage;

for (const shipType of shipSpecsById.keys()) {
  const fresh = createPlayerShip(world, { shipType });

  assert.equal(fresh.fuel, fresh.fuelCapacity);
}

for (const [forward, turn, factor] of [
  [1, 0, 1],
  [0, 1, 0.5],
  [0, -1, 0.5],
  [1, 1, 1],
  [0, 0, 0],
]) {
  ship.fuel = ship.fuelCapacity;
  ship.fly(forward, turn);
  ship.update(1);
  near(ship.fuelCapacity - ship.fuel, usage * factor);
}

ship.fuel = ship.fuelCapacity;
const normalSpeed = ship.maxSpeed;
const normalTurn = ship.rotationalThrust;

ship.fuel = ship.fuelCapacity * 0.05;
assert(!ship.lowFuel, 'exactly 5% still has normal speed');
ship.fuel = 3;
ship.fly(1, 1);
assert(ship.lowFuel);
near(ship.maxSpeed, normalSpeed / 2);
near(ship.rotationalThrust, normalTurn / 2);
ship.update(1);
near(ship.fuel, 3 - usage * 0.25);
const state = new EntityState(ship);

ship.update(1);
state.restore();
near(ship.fuel, 3 - usage * 0.25);

ship.fuel = 1e-10;
ship.update(1);
assert.equal(ship.fuel, 0);
assert.equal(ship.forwardThrust, 0);
assert.equal(ship.rotationalThrust, 0);
assert(
  ship.segments
    .filter((segment) => segment.module.forwardThrust)
    .every((segment) => segment.active === 0),
);

const action = { action: 'refuel' as const };

assert.deepEqual(
  decodeClientMessage(encodeClientMessage({ type: 'dock', ...action })),
  { type: 'dock', ...action },
);
const account = { credits: 100 };

assert.equal(
  ship.applyDockAction(action, account),
  undefined,
  'refueling requires a station',
);
const station = new Station({ world, id: 999 });

addEntity(world, station);
ship.dockedTo = station.id;
assert.equal(ship.refuelCost, 24);
assert.equal(ship.applyDockAction(action, { credits: 23 }), undefined);
assert(ship.applyDockAction(action, account));
assert.equal(account.credits, 76);
assert.equal(ship.fuel, ship.fuelCapacity);
assert.equal(
  ship.applyDockAction(action, account),
  undefined,
  'cannot charge for a full tank',
);
ship.update(1);
assert.equal(ship.fuel, ship.fuelCapacity, 'docked controls use no fuel');
ship.fuel = 60;
assert.equal(ship.refuelCost, 12);

ship.dockedTo = undefined;

// Full thrust uses the normal rate down to the reserve, then one quarter.
for (const id of ['thrusterSingleSm', 'thrusterTriple'] as const) {
  const ship = createPlayerShip(world, {
    shipType: id === 'thrusterSingleSm' ? 'arrow' : 'mustang',
  });

  const Type = moduleTypesById.get(id)!;

  ship.fit(new Type(), ship.engine.mount);
  ship.fuel = ship.fuelCapacity;
  ship.fly(1, 0);
  const usage = ship.engine.fuelUsage;

  ship.consumeFuel((ship.fuelCapacity * 0.95) / usage);
  near(ship.fuel, ship.fuelCapacity * 0.05);
  ship.consumeFuel((ship.fuel - usage * 0.25) / (usage * 0.25));
  assert(ship.fuel > 0);
  ship.consumeFuel(1);
  near(ship.fuel, 0);
}
