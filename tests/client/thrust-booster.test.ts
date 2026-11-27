import assert from 'node:assert/strict';
import { createBoosterShip } from '../support/booster-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { Ship } from '../../src/client/objects/ship';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';
import type { Mount } from '../../src/client/types';

const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

// Synthetic timing keeps the charge/lockout cases independent of tuning.
const makeShip = (rampDuration = 0, charges = 3) => {
  const Type = moduleTypesById.get('thrustBooster')!;

  Type.booster = {
    multiplier: 1.5,
    rampDuration,
    duration: 2,
    cooldown: 2,
    charges,
    recharge: 6,
  };

  const ship = createBoosterShip();
  const boosters = ship.modules.filter((module) => module.booster);
  const mounts = boosters.map((module) => module.mount as Mount);

  const multiplier = boosters.reduce(
    (factor, module) => factor * module.booster.multiplier,
    1,
  );

  return { ship, mounts, boosters, multiplier };
};

const press = (ship: Ship) => {
  ship.triggerThrustBoost(false);
  ship.triggerThrustBoost(true);
};

{
  const { ship, boosters } = makeShip(0.2);
  const normalSpeed = ship.maxSpeed;
  const forward = ship.forwardThrust;
  const rotation = ship.rotationalThrust;

  press(ship);
  near(ship.thrustBoostFactor, 1);
  near(ship.maxSpeed, normalSpeed);

  for (let step = 1; step <= 4; step++) {
    ship.updateModules(0.05);
    const factor = boosters.reduce(
      (value, module) =>
        value * (1 + ((module.booster.multiplier - 1) * step) / 4),
      1,
    );

    near(ship.thrustBoostFactor, factor);
    near(ship.thrustBoostSpeedFactor, factor);
    near(ship.forwardThrust, forward * factor);
    near(ship.rotationalThrust, rotation * factor);
    near(ship.maxSpeed, normalSpeed * factor);

    if (step === 2) {
      const { ship: restored } = makeShip(0.2);

      restored.moduleStates = structuredClone(ship.moduleStates);
      near(restored.thrustBoostFactor, factor);
      near((cloneEntity({ entity: ship }) as Ship).thrustBoostFactor, factor);
      const checkpoint = new EntityState(ship);

      ship.updateModules(0.3);
      checkpoint.restore();
      near(ship.thrustBoostFactor, factor);
    }
  }
}

{
  const { ship, mounts, boosters, multiplier } = makeShip();
  const normalCap = ship.maxSpeed;
  const forward = ship.forwardThrust;
  const rotation = ship.rotationalThrust;
  const idlePower = boosters.reduce((sum, module) => sum + module.power, 0);
  const chargingPower = boosters.reduce(
    (sum, module) => sum + module.powerCharging,
    0,
  );
  const boosterPower = () =>
    ship.powerEntries.reduce(
      (sum, entry) => sum + (boosters.includes(entry.module) ? entry.value : 0),
      0,
    );

  near(boosterPower(), idlePower);
  press(ship);
  near(boosterPower(), chargingPower);
  ship.updateModules(2);
  near(ship.thrustBoostFactor, 1);
  near(ship.forwardThrust, forward);
  near(ship.rotationalThrust, rotation);
  near(ship.thrustBoostSpeedFactor, multiplier);
  near(ship.maxSpeed, normalCap * multiplier);
  near(boosterPower(), chargingPower);
  ship.updateModules(1);
  const halfway = boosters.reduce(
    (factor, module) => factor * (1 + (module.booster.multiplier - 1) * 0.5),
    1,
  );

  near(ship.thrustBoostSpeedFactor, halfway);
  near(ship.maxSpeed, normalCap * halfway);
  ship.updateModules(1);
  near(ship.thrustBoostSpeedFactor, 1);
  near(ship.maxSpeed, normalCap);

  for (const mount of mounts) ship.fit(0, mount);
  near(ship.maxSpeed, normalCap, 1e-8);
}

{
  const { ship, boosters } = makeShip(0, 1);
  const { ship: fine, boosters: fineBoosters } = makeShip(0, 1);

  press(ship);
  press(fine);
  ship.systemsPower = fine.systemsPower = 0.5;
  ship.updateModules(4);

  for (let frame = 0; frame < 240; frame++) fine.updateModules(1 / 60);

  near(boosters[0].chargeCooldown, 5);
  near(fineBoosters[0].chargeCooldown, boosters[0].chargeCooldown);
  near(fineBoosters[0].fireCooldown, boosters[0].fireCooldown);
  press(ship);
  near(boosters[0].fireCooldown, 0);
  near(boosters[0].chargeCooldown, 5);
  ship.updateModules(10);
  ship.triggerThrustBoost(true);
  near(boosters[0].fireCooldown, 0);
  press(ship);
  near(boosters[0].chargeCooldown, 6);
  near(boosters[0].fireCooldown, 4);
}

{
  const { ship, boosters, multiplier } = makeShip();

  // Slow recharge isolates the three-charge pool from the shorter lockout.
  for (const booster of boosters) {
    booster.booster = { ...booster.booster, recharge: 60 };
  }

  for (let charge = 0; charge < 3; charge++) {
    press(ship);
    near(ship.thrustBoostFactor, multiplier);
    ship.updateModules(4);
  }

  const debt = boosters[0].chargeCooldown;

  press(ship);
  near(ship.thrustBoostFactor, 1);
  near(boosters[0].fireCooldown, 0);
  near(boosters[0].chargeCooldown, debt);
}

{
  const { ship, mounts, boosters } = makeShip();

  boosters[0].chargeCooldown = 12.5;
  press(ship);
  near(ship.thrustBoostFactor, boosters[1].booster.multiplier);
  near(boosters[0].chargeCooldown, 12.5);
  near(boosters[1].chargeCooldown, 6);
  ship.updateModules(1);
  press(ship);
  near(ship.thrustBoostFactor, boosters[1].booster.multiplier);
  near(boosters[0].chargeCooldown, 11.5);
  mounts[1].health = 0;
  near(ship.thrustBoostFactor, 1);
  ship.updateModules(3);
  boosters[0].chargeCooldown = 0;
  const destroyedCharge = boosters[1].chargeCooldown;

  press(ship);
  near(ship.thrustBoostFactor, boosters[0].booster.multiplier);
  near(boosters[1].chargeCooldown, destroyedCharge);

  mounts[0].hull.health = 0;
  near(ship.thrustBoostFactor, 1);
}

for (const block of [
  (ship: Ship) => (ship.dead = true),
  (ship: Ship) => (ship.systemsPower = 0),
  (ship: Ship) => (ship.dockedTo = 12),
  (ship: Ship) => (ship.transitTime = -1),
  (ship: Ship) => (ship.launching = 1),
  (ship: Ship) => (ship.fuel = 0),
]) {
  const { ship, boosters } = makeShip();

  block(ship);
  press(ship);
  near(ship.thrustBoostFactor, 1);
  near(boosters[0].fireCooldown, 0);
  near(boosters[0].chargeCooldown, 0);
}

{
  const { ship, boosters, multiplier } = makeShip();
  const checkpoint = new EntityState(ship);

  ship.triggerThrustBoost(true);
  checkpoint.restore();
  ship.triggerThrustBoost(true);
  near(ship.thrustBoostFactor, multiplier);
  near(boosters[0].chargeCooldown, 6);

  const heldCheckpoint = new EntityState(ship);

  ship.triggerThrustBoost(false);
  heldCheckpoint.restore();
  ship.updateModules(4);
  ship.triggerThrustBoost(true);
  near(boosters[0].fireCooldown, 0);
  near(boosters[0].chargeCooldown, 4);
}
