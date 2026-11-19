import { createBoosterShip } from '../support/booster-ship';
import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { flight } from '../../src/specs/control-ship';

for (const Type of [
  moduleTypesById.get('thrusterSingleSm')!,
  moduleTypesById.get('thrusterSingleMd')!,
]) {
  const turning = createBoosterShip();
  const engine = new Type();

  turning.fit(engine, turning.mounts[0]);

  for (const [forward, turn, expected] of [
    [0, 1, 0.5],
    [0, -1, 0.5],
    [1, 1, 0.5],
    [1, -1, 0.5],
    [1, 0.5, 0.75],
    [1, 0, 1],
    [0, 0, 0],
  ]) {
    turning.fly(forward, turn);
    assert(
      turning
        .segmentsAtMount(engine.mount)
        .every((segment) => Math.abs(segment.active - expected) < 1e-9),
      'single nozzles show a half-strength turning flame with or without forward thrust',
    );
  }
}

{
  const turning = createBoosterShip();
  const Type = moduleTypesById.get('thrusterDualSm')!;
  const engine = new Type();

  turning.fit(engine, turning.mounts[0]);

  for (const turn of [-1, 1]) {
    for (const forward of [0, 1]) {
      turning.fly(forward, turn);

      for (const segment of turning.segmentsAtMount(engine.mount)) {
        assert.equal(
          segment.active,
          turn === -segment.thrusterNozzleSide
            ? 1
            : forward * flight.steeringEase,
          'dual nozzles keep differential steering',
        );
      }
    }
  }
}

const ship = createPlayerShip(createWorld(), { shipType: 'moth' });
const mounts = ship.mounts.filter(
  ({ module }) => module && module.forwardThrust,
);
const [first, second] = mounts;

assert(first.module && second.module);
const firstThruster = first.module;
const secondThruster = second.module;
const close = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

assert.equal(mounts.length, 2);
assert.equal(ship.thrusterMountCount, 2);
close(ship.forwardThrust, firstThruster.forwardThrust);
close(ship.rotationalThrust, firstThruster.rotationalThrust);
close(ship.maxSpeed, firstThruster.forwardThrust * flight.speedPerThrust);

ship.fly(1, 0);
ship.consumeFuel(1);
close(
  ship.fuelCapacity - ship.fuel,
  firstThruster.fuelUsage + secondThruster.fuelUsage,
);

ship.fit(0, second);
close(ship.forwardThrust, firstThruster.forwardThrust / 2);
close(ship.rotationalThrust, firstThruster.rotationalThrust / 2);
close(ship.maxSpeed, (firstThruster.forwardThrust * flight.speedPerThrust) / 2);
ship.fuel = ship.fuelCapacity;
ship.consumeFuel(1);
close(ship.fuelCapacity - ship.fuel, firstThruster.fuelUsage);

const LargerThruster = moduleTypesById.get('thrusterDualLg')!;
const larger = new LargerThruster();

ship.fit(larger, second);
close(
  ship.forwardThrust,
  (firstThruster.forwardThrust + larger.forwardThrust) / 2,
);
close(
  ship.rotationalThrust,
  (firstThruster.rotationalThrust + larger.rotationalThrust) / 2,
);

second.health = 0;
close(ship.forwardThrust, firstThruster.forwardThrust / 2);
second.health = larger.health;
second.hull.health = 0;
close(ship.forwardThrust, firstThruster.forwardThrust / 2);
close(ship.rotationalThrust, firstThruster.rotationalThrust / 2);

const health = ship.hullHealth;

ship.hullHealth = health;
assert.equal(
  ship.thrusterMountCount,
  2,
  'destroyed hull keeps its mount in the denominator',
);
close(ship.forwardThrust, firstThruster.forwardThrust / 2);
close(ship.rotationalThrust, firstThruster.rotationalThrust / 2);
assert.equal(ship.thrusterTotal('forward'), firstThruster.forwardThrust);
ship.fuel = ship.fuelCapacity;
ship.consumeFuel(1);
close(ship.fuelCapacity - ship.fuel, firstThruster.fuelUsage);

ship.fit(0, first);
assert.equal(ship.forwardThrust, 0);
assert.equal(ship.rotationalThrust, 0);

const noThrusterMounts = createPlayerShip(createWorld());

noThrusterMounts.hullSegments = noThrusterMounts.hullSegments.map(
  (segment) => ({
    ...segment,
    mounts: undefined as undefined,
  }),
);

assert.equal(noThrusterMounts.thrusterMountCount, 0);
assert.equal(noThrusterMounts.forwardThrust, 0);
assert.equal(noThrusterMounts.rotationalThrust, 0);
