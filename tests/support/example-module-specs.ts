import { exampleBeam } from '../../src/specs/modules/offense/example-beam';
import { exampleWeapon } from '../../src/specs/modules/offense/example-weapon';
import { colors } from '../../src/specs/colors';
import { exampleDrill } from '../../src/specs/modules/offense/example-drill';
import { exampleCargoHatch } from '../../src/specs/modules/utility/example-cargo-hatch';
import { exampleSearchLight } from '../../src/specs/modules/utility/example-search-light';
import {
  exampleShield,
  exampleLargeShield,
} from '../../src/specs/modules/utility/example-shield';
import { examplePowerPlant } from '../../src/specs/modules/core/example-power-plant';
import {
  exampleThruster,
  exampleTripleThruster,
  exampleSmallThruster,
  exampleLargeThruster,
  exampleExtraLargeThruster,
  exampleDualThruster,
  exampleLargeDualThruster,
  exampleExtraLargeDualThruster,
} from '../../src/specs/modules/core/example-thruster';
import type { ModuleId } from '../../src/specs/modules';
import type { ModuleSpec } from '../../src/specs/modules/types';

// Reuse protocol/control slots in isolated test catalogs. No examples are
// registered in the playable catalog, shops, loadouts, or production bundles.
export const exampleModuleEntries: [ModuleId, ModuleSpec][] = [
  ['laser', exampleBeam],
  // Exercise ammo, spin-down, fading, and the absence of recoil/explosions.
  [
    'autogun',
    {
      ...exampleWeapon,
      power: 0.1,
      powerActivated: 1.6,
      powerCharging: undefined,
      price: 600,
      activationDuration: 500,
      chargeDuration: 1000,
      retractionDistance: 15,
      damage: 3,
      fireInterval: 200,
      recoil: undefined,
      barrelLength: 22,
      projectile: {
        ...exampleWeapon.projectile,
        speed: 1000,
        lifetime: 1000,
        radius: 2,
        color: colors.yellow[2],
        explosion: undefined,
        glow: { color: colors.yellow[2], alpha: 0.2, radius: 14 },
      },
      // Two offset barrels and two collars exercise the spinning renderer.
      model: [
        ...[-1, 1].map((side) => ({
          ...exampleWeapon.model[1],
          points: [
            [0, side * 0.5],
            [22, side * 0.5],
            [22, side * 3],
            [0, side * 3],
          ],
        })),
        ...[
          [17, 21],
          [0, 4],
        ].map(([start, end]) => ({
          ...exampleWeapon.model[1],
          points: [
            [start, -4],
            [end, -4],
            [end, 4],
            [start, 4],
          ],
        })),
      ],
    },
  ],
  // Expiry must explode instead of fading, without requiring ammunition.
  [
    'plasmaAccelerator',
    {
      ...exampleWeapon,
      ammo: undefined,
      dischargeDuration: 0,
      projectile: {
        ...exampleWeapon.projectile,
        fadeOut: undefined,
        effect: undefined,
      },
    },
  ],
  ['hornDrill', exampleDrill],
  ['cargoHatch', exampleCargoHatch],
  ['searchLight', exampleSearchLight],
  ['shieldGeneratorSm', exampleShield],
  ['shieldGeneratorMd', exampleLargeShield],
  ['powerPlant', examplePowerPlant],
  ['thrusterSingleMd', exampleThruster],
  ['thrusterSingleSm', exampleSmallThruster],
  ['thrusterTriple', exampleTripleThruster],
  ['thrusterSingleLg', exampleLargeThruster],
  ['thrusterSingleXl', exampleExtraLargeThruster],
  ['thrusterDualMd', exampleDualThruster],
  ['thrusterDualLg', exampleLargeDualThruster],
  ['thrusterDualXl', exampleExtraLargeDualThruster],
];
