import assert from 'node:assert/strict';
import { createBoosterShip } from '../support/booster-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import type { Ship } from '../../src/client/objects/ship';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const makeShip = () => {
  const Type = moduleTypesById.get('thrustBooster')!;

  Type.booster = {
    multiplier: 1.4,
    duration: 3,
    cooldown: 1,
    recharge: 5,
    charges: 1,
    rampDuration: 0.2,
  };

  const ship = createBoosterShip();
  const boosts = ship.modules.filter((module) => module.booster);

  return { ship, boosts, config: boosts[0].booster };
};

const press = (ship: Ship) => {
  ship.triggerThrustBoost(false);
  ship.triggerThrustBoost(true);
};

{
  const { ship, boosts, config } = makeShip();
  const multiplier = boosts.reduce(
    (factor, module) => factor * module.booster.multiplier,
    1,
  );

  press(ship);

  for (const module of boosts) {
    near(module.chargeCooldown, config.recharge);
    near(module.fireCooldown, config.duration + config.cooldown);
  }

  ship.updateModules(config.rampDuration);
  near(ship.thrustBoostFactor, multiplier);
  near(boosts[0].chargeCooldown, config.recharge);
  ship.updateModules(config.duration - config.rampDuration);
  near(ship.thrustBoostFactor, 1);
  near(boosts[0].chargeCooldown, config.recharge);
  ship.updateModules(config.cooldown);

  const lockoutDuration = config.duration + config.cooldown;
  const debt = config.recharge - config.cooldown;

  press(ship);

  for (const module of boosts) {
    near(module.fireCooldown, 0);
    near(module.chargeCooldown, debt);
  }

  ship.updateModules(debt - 0.01);
  press(ship);
  near(boosts[0].chargeCooldown, 0.01);
  near(boosts[0].fireCooldown, 0);
  ship.updateModules(0.01);
  ship.triggerThrustBoost(true);
  near(boosts[0].chargeCooldown, 0);
  near(boosts[0].fireCooldown, 0);
  press(ship);
  near(boosts[0].chargeCooldown, config.recharge);
  near(boosts[0].fireCooldown, lockoutDuration);
}

{
  const { ship, boosts, config } = makeShip();

  ship.triggerThrustBoost(true);
  ship.updateModules(config.duration + config.recharge);
  ship.triggerThrustBoost(true);
  near(boosts[0].chargeCooldown, 0);
  near(boosts[0].fireCooldown, 0);
  press(ship);
  near(boosts[0].chargeCooldown, config.recharge);
  near(boosts[0].fireCooldown, config.duration + config.cooldown);
}

{
  const { ship: coarse, boosts, config } = makeShip();
  const { ship: fine, boosts: fineBoosts } = makeShip();

  press(coarse);
  press(fine);
  coarse.updateModules(config.duration + 0.5);

  for (let frame = 0; frame < (config.duration + 0.5) * 60; frame++) {
    fine.updateModules(1 / 60);
  }

  near(boosts[0].chargeCooldown, config.recharge - 0.5);
  near(fineBoosts[0].chargeCooldown, boosts[0].chargeCooldown);
  near(fineBoosts[0].fireCooldown, boosts[0].fireCooldown);
}

{
  const { ship, boosts, config } = makeShip();

  press(ship);
  ship.systemsPower = 0.5;
  ship.updateModules(config.duration + 0.5);
  near(boosts[0].chargeCooldown, config.recharge - 0.25);
}

{
  const { ship, boosts, config } = makeShip();

  boosts[0].chargeCooldown = config.recharge;
  press(ship);
  ship.updateModules(config.duration);
  near(boosts[0].chargeCooldown, config.recharge - config.duration);
  near(boosts[1].chargeCooldown, config.recharge);
  ship.updateModules(0.5);
  near(boosts[0].chargeCooldown, config.recharge - config.duration - 0.5);
  near(boosts[1].chargeCooldown, config.recharge - 0.5);
}

for (const block of [
  (ship: Ship) => (ship.dead = true),
  (ship: Ship) => (ship.systemsPower = 0),
]) {
  const { ship, boosts } = makeShip();

  block(ship);
  press(ship);

  for (const module of boosts) {
    near(module.chargeCooldown, 0);
    near(module.fireCooldown, 0);
  }
}

{
  const { ship, boosts } = makeShip();

  for (const module of boosts) module.mount.health = 0;

  press(ship);

  for (const module of boosts) {
    near(module.chargeCooldown, 0);
    near(module.fireCooldown, 0);
  }
}

for (const phase of ['burst', 'recharge']) {
  const { ship, boosts, config } = makeShip();
  const elapsed =
    phase === 'burst'
      ? config.duration / 2
      : config.duration + config.recharge / 2;

  press(ship);
  ship.updateModules(elapsed);
  const { ship: hydrated } = makeShip();

  hydrated.moduleStates = structuredClone(ship.moduleStates);
  const clone = cloneEntity({ entity: ship }) as Ship;
  const checkpoint = new EntityState(ship);

  ship.updateModules(config.duration + config.recharge);
  checkpoint.restore();
  const remainingLockout = Math.max(
    0,
    config.duration + config.cooldown - elapsed,
  );
  const remainingRecharge =
    config.recharge - Math.max(0, elapsed - config.duration);
  const remainingTime = Math.max(
    0,
    config.duration + config.recharge - elapsed,
  );

  for (const result of [ship, hydrated, clone]) {
    const module = result.modules.find(
      (candidate) => candidate.constructor === boosts[0].constructor,
    )!;

    near(module.chargeCooldown, remainingRecharge);
    near(module.fireCooldown, remainingLockout);
    press(result);
    near(module.fireCooldown, remainingLockout);
    near(module.chargeCooldown, remainingRecharge);
    result.updateModules(remainingTime);
    press(result);
    near(module.chargeCooldown, config.recharge);
    near(module.fireCooldown, config.duration + config.cooldown);
  }
}
