import { type Module } from '../../objects/modules/module';
import { flight } from '../../../specs/control-ship';

const weaponNumber = (value: number) => String(Number(value.toFixed(2)));

export const moduleWeaponDps = (module: Module | typeof Module) => {
  const beam = module.behavior === 'beam';

  if (!beam && !module.projectile) return '';
  return weaponNumber(module.damage * (beam ? 30 : 1 / module.fireInterval));
};

export const moduleWeaponMarkup = (module: Module | typeof Module) => {
  const beam = module.behavior === 'beam';

  if (!beam && !module.projectile) return '';
  const rate = beam ? 0 : 1 / module.fireInterval;
  const aoe = module.projectile?.explosion?.radius || 0;
  const stat = (label: string, value: string, title: string) =>
    `<div title="${title}"><span class="block text-muted text-sm uppercase">${label}</span><span class="text-color text-lg">${value}</span></div>`;

  return `<div class="flex items-center gap-12">${stat('Damage', weaponNumber(module.damage), beam ? 'Damage per 1/30 second of continuous beam' : 'Direct-hit damage per shot')}${stat('ROF', beam ? '∞' : `${weaponNumber(rate)}/s`, 'Fully powered rate of fire')}${aoe > 0 ? stat('AOE', `${aoe} m`, 'Explosion radius') : ''}</div>`;
};

export const modulePowerMarkup = (module: Module | typeof Module) => {
  if (module.forwardThrust) return '';

  if (module.powerGenerated) {
    return `<div class="flex items-center gap-12 mt-6"><div><span class="block text-muted text-sm uppercase">Generation</span><span class="text-color text-lg">${module.powerGenerated.toFixed(1)} MW</span></div><div><span class="block text-muted text-sm uppercase">Storage</span><span class="text-color text-lg">${module.powerCapacity ?? 0} MJ</span></div></div>`;
  }

  const row = (label: string, value: number) =>
    `<div class="flex items-center justify-between gap-3 text-muted text-sm mt-6"><span class="uppercase">${label}</span><span>${value.toFixed(1)} MW</span></div>`;
  const { booster, powerActivated = 0, powerCharging } = module;

  return [
    booster
      ? `<div class="flex items-center justify-between gap-3 text-muted text-sm mt-6"><span class="uppercase">Thrust boost</span><span>+${weaponNumber((booster.multiplier - 1) * 100)}%</span></div>`
      : '',
    row('Idle power', module.power ?? 0),
    powerCharging === powerActivated ? '' : row('Active power', powerActivated),
    module.powerFiring ? row('Firing power', module.powerFiring) : '',
    powerCharging === undefined
      ? ''
      : row(
          booster || module.rechargeDuration
            ? 'Recharge power'
            : 'Charging power',
          powerCharging,
        ),
  ].join('');
};

export const moduleThrusterMarkup = (
  module: Module | typeof Module,
  turnRate?: number,
) => {
  if (!module.forwardThrust) return '';

  const row = (label: string, value: string, title: string) =>
    `<div class="flex items-center justify-between gap-3 text-muted text-sm mt-6" title="${title}"><span class="uppercase">${label}</span><span>${value}</span></div>`;

  const turnLabel = turnRate === undefined ? 'Turn thrust' : 'Turn rate';
  const turnValue =
    turnRate === undefined
      ? `${module.rotationalThrust}`
      : `${((((turnRate * module.rotationalThrust) / flight.spinDivisor) * 180) / Math.PI).toFixed(0)} °/s`;
  const turnTitle =
    turnRate === undefined
      ? 'Turning strength; actual turn rate depends on the ship'
      : 'Full-power turn rate on the current ship if every thruster mount has this thruster';

  return [
    `<div class="flex items-center gap-6 mt-6"><div title="Full-power max speed if every thruster mount has this thruster"><span class="block text-muted text-sm uppercase">Max speed</span><span class="text-color text-lg">${module.forwardThrust * flight.speedPerThrust} m/s</span></div><div title="${turnTitle}"><span class="block text-muted text-sm uppercase">${turnLabel}</span><span class="text-color text-lg">${turnValue}</span></div></div>`,
    row(
      'Power use',
      `${(module.powerActivated ?? module.power ?? 0).toFixed(1)} MW`,
      'Power used by this thruster',
    ),
    row(
      'Fuel usage',
      `${(module.fuelUsage * 60).toFixed(1)} L/min`,
      'Fuel used at full forward thrust',
    ),
  ].join('');
};
