import assert from 'node:assert/strict';
import {
  Autogun,
  CannonSm,
  Laser,
  PlasmaAccelerator,
  PowerPlant2V,
} from '../../src/client/objects/modules';
import {
  moduleWeaponDps,
  moduleWeaponMarkup,
} from '../../src/client/ui/dom/module-details';

const value = (markup: string, label: string) =>
  markup.match(
    new RegExp(`${label}</span><span class="text-color text-lg">([^<]+)`),
  )?.[1];

for (const weapon of [Autogun, new Autogun()]) {
  const details = moduleWeaponMarkup(weapon);

  assert.equal(value(details, 'Damage'), '3');
  assert.equal(value(details, 'DPS'), undefined);
  assert.equal(moduleWeaponDps(weapon), '18.75');
  assert.equal(value(details, 'ROF'), '6.25/s');
  assert.equal(value(details, 'AOE'), undefined);
}

const cannon = moduleWeaponMarkup(CannonSm);

assert.equal(value(cannon, 'Damage'), '3');
assert.equal(moduleWeaponDps(CannonSm), '3');
assert.equal(value(cannon, 'ROF'), '1/s');
assert.equal(value(cannon, 'AOE'), undefined);

const plasma = moduleWeaponMarkup(PlasmaAccelerator);

assert.equal(value(plasma, 'Damage'), '15');
assert.equal(moduleWeaponDps(PlasmaAccelerator), '5');
assert.equal(value(plasma, 'ROF'), '0.33/s');
assert.equal(value(plasma, 'AOE'), '24 m');

const laser = moduleWeaponMarkup(Laser);

assert.equal(value(laser, 'Damage'), '0.2');
assert.equal(moduleWeaponDps(Laser), '6');
assert.equal(value(laser, 'ROF'), '∞');
assert.equal(value(laser, 'AOE'), undefined);
assert.equal(moduleWeaponMarkup(PowerPlant2V), '');
assert.equal(moduleWeaponDps(PowerPlant2V), '');
