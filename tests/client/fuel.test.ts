import assert from 'node:assert/strict';
import { Station } from '../../src/client/objects/station';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import { EntityState } from '../../src/client/simulation/entity-state';
import { flight } from '../../src/specs/control-ship';
import { createBoosterShip } from '../support/booster-ship';

const world = createWorld();
const ship = createBoosterShip({ world });
const usage = 4;

ship.engine.fuelUsage = usage;
assert.equal(ship.fuel, ship.fuelCapacity);

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

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

ship.fuel = ship.fuelCapacity * flight.lowFuelThreshold;
assert(!ship.lowFuel, 'the reserve boundary still has normal speed');
const lowFuel = ship.fuel / 2;

ship.fuel = lowFuel;
ship.fly(1, 1);
assert(ship.lowFuel);
near(ship.maxSpeed, normalSpeed * flight.lowFuelSpeed);
near(ship.rotationalThrust, normalTurn * flight.lowFuelSpeed);
ship.update(1);
near(ship.fuel, lowFuel - usage * flight.lowFuelUsage);
const state = new EntityState(ship);

ship.update(1);
state.restore();
near(ship.fuel, lowFuel - usage * flight.lowFuelUsage);

const reserve = ship.fuelCapacity * flight.lowFuelThreshold;

ship.fuel = reserve + usage / 2;
ship.consumeFuel(1);
near(ship.fuel, reserve - (usage / 2) * flight.lowFuelUsage);

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

const account = { credits: 100 };

assert.equal(
  ship.applyDockAction(action, account),
  undefined,
  'refueling requires a station',
);
const station = new Station({ world, id: 999 });

addEntity(world, station);
ship.dockedTo = station.id;
const refillCost = Math.ceil(ship.fuelCapacity * flight.fuelPrice);

assert.equal(ship.refuelCost, refillCost);
assert.equal(
  ship.applyDockAction(action, { credits: refillCost - 1 }),
  undefined,
);
assert(ship.applyDockAction(action, account));
assert.equal(account.credits, 100 - refillCost);
assert.equal(ship.fuel, ship.fuelCapacity);
assert.equal(
  ship.applyDockAction(action, account),
  undefined,
  'cannot charge for a full tank',
);
ship.update(1);
assert.equal(ship.fuel, ship.fuelCapacity, 'docked controls use no fuel');
ship.fuel = ship.fuelCapacity - 0.5;
assert.equal(ship.refuelCost, 0, 'fuel that displays as full has no cost');
assert.equal(ship.applyDockAction(action, account), undefined);
ship.fuel = ship.fuelCapacity - 0.51;
assert.equal(ship.refuelCost, Math.ceil(0.51 * flight.fuelPrice));
assert(ship.applyDockAction(action, account));
assert.equal(ship.fuel, ship.fuelCapacity);
