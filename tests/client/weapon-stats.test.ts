import assert from 'node:assert/strict';
import { Autogun, Laser } from '../../src/client/objects/modules';
import {
  moduleWeaponDps,
  moduleWeaponMarkup,
} from '../../src/client/ui/dom/module-details';
import { exampleWeapon } from '../../src/specs/modules/offense/example-weapon';

const displayed = (markup: string, label: string) =>
  markup.match(
    new RegExp(`${label}</span><span class="text-color text-lg">([^<]+)`),
  )?.[1];

const blast = { radius: 18, impulse: 0 };

const weapon = new Autogun({
  damage: 7.123,
  fireInterval: 3,
  projectile: { ...exampleWeapon.projectile, explosion: blast },
});

const details = moduleWeaponMarkup(weapon);

assert.equal(displayed(details, 'Damage'), '7.12');
assert.equal(displayed(details, 'DPS'), undefined);
assert.equal(moduleWeaponDps(weapon), '2.37');
assert.equal(displayed(details, 'ROF'), '0.33/s');
assert.equal(displayed(details, 'AOE'), '18 m');

const beam = new Laser({ damage: 0.15 });
const beamDetails = moduleWeaponMarkup(beam);

assert.equal(displayed(beamDetails, 'Damage'), '0.15');
assert.equal(displayed(beamDetails, 'ROF'), '∞');
assert.equal(displayed(beamDetails, 'AOE'), undefined);
assert.equal(moduleWeaponDps(beam), '4.5');
