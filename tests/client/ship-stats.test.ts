import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { shipStats } from '../../src/client/ui/dom/ship-stats';
import { simulationStep } from '../../src/specs/simulation';

const ship = createPlayerShip(createWorld());
const original = shipStats(ship);

assert.equal(original.mass, 4175);
assert.equal(original.powerCapacity, 48);
assert.equal(original.maxSpeed, 272);
assert(Math.abs(original.acceleration - 391.1111111111111) < 1e-9);
assert(Math.abs(original.turnRate - (3 * 180) / Math.PI) < 1e-9);

const moving = createPlayerShip(createWorld());

moving.fly(1, 0);
moving.update(simulationStep);
assert(
  Math.abs(
    (Math.hypot(moving.velocity.x, moving.velocity.y) *
      Math.exp(moving.movementDrag() * simulationStep)) /
      simulationStep -
      shipStats(moving).acceleration,
  ) < 1e-4,
  'displayed acceleration matches the initial forward velocity change, accounting for drag',
);

for (const [behavior, candidateId] of [
  ['powerPlant', 'powerPlant2H'],
  ['thruster', 'thrusterDualLg'],
] as const) {
  const mount = ship.mounts.find(
    ({ module }) => module && module.behavior === behavior,
  );

  assert(mount);
  ship.fit(0, mount);

  const Type = moduleTypesById.get(candidateId)!;
  const projected = shipStats(ship, Type);

  ship.fit(new Type(), mount);

  const installed = shipStats(ship);

  for (const key of [
    'mass',
    'powerCapacity',
    'acceleration',
    'maxSpeed',
    'turnRate',
  ] as const) {
    assert(
      Math.abs(projected[key] - installed[key]) < 1e-9,
      `${candidateId}: ${key}`,
    );
  }
}

const unpowered = createPlayerShip(createWorld());
const powerMount = unpowered.mounts.find(
  ({ module }) => module && module.behavior === 'powerPlant',
);

assert(powerMount);
unpowered.fit(0, powerMount);
unpowered.storedPower = 0;
unpowered.updatePower(simulationStep);
assert.equal(unpowered.thrusterPower, 0);

const PowerPlant = moduleTypesById.get('powerPlant2H')!;
const poweredPreview = shipStats(unpowered, PowerPlant);

unpowered.fit(new PowerPlant(), powerMount);
unpowered.updatePower(simulationStep);

assert(unpowered.thrusterPower > 0);
assert.deepEqual(poweredPreview, shipStats(unpowered));
