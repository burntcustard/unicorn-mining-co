import assert from 'node:assert/strict';
import { createBoosterShip } from '../support/booster-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { shipStats } from '../../src/client/ui/dom/ship-stats';
import { simulationStep } from '../../src/specs/simulation';

const ship = createBoosterShip();
const moving = createBoosterShip();

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

const unpowered = createBoosterShip();
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
