import type { ModuleSpec } from '../../specs/modules/types';

/**
 * Convert authored millisecond durations to the simulation's seconds without
 * changing the source spec, effect timings, or per-second rates.
 */
export const moduleSpecForSimulation = (spec: ModuleSpec): ModuleSpec => {
  const value = { ...spec };

  if (value.activationDuration !== undefined) value.activationDuration /= 1000;

  if (value.chargeDuration !== undefined) value.chargeDuration /= 1000;

  if (value.dischargeDuration !== undefined) value.dischargeDuration /= 1000;

  if (value.rechargeDuration !== undefined) value.rechargeDuration /= 1000;

  if (value.coverDuration !== undefined) value.coverDuration /= 1000;

  if (value.fireInterval !== undefined) value.fireInterval /= 1000;

  if (value.booster) {
    value.booster = {
      ...value.booster,
      rampDuration: (value.booster.rampDuration || 0) / 1000,
      duration: value.booster.duration / 1000,
      cooldown: value.booster.cooldown / 1000,
      recharge: value.booster.recharge / 1000,
    };
  }

  if (value.projectile) {
    value.projectile = {
      ...value.projectile,
      lifetime: value.projectile.lifetime / 1000,
    };
  }

  value.model = spec.model.map((part) => ({
    ...part,
    rechargeDelay:
      part.rechargeDelay === undefined ? undefined : part.rechargeDelay / 1000,
  }));

  return value;
};
