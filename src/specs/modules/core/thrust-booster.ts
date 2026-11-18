import { colors } from '../../colors';
import { renderingLayers } from '../../rendering-layers';
import type { ModuleSpec } from '../types';

const recharge = 5000;

export const thrustBooster = {
  icon: './thrust-booster.svg',
  behavior: 'thrustBooster',
  name: 'Thrust Booster',
  description:
    'Press Shift for a temporary 30% increase in forward and turning thrust. Extra speed allowance eases out during recovery. Multiple boosts multiply their output.',
  mass: 50,
  health: 15,
  power: 0.1,
  powerActivated: 0.8,
  powerCharging: 0.8,
  price: 300,
  zIndex: renderingLayers.modulesAboveShipHull,
  shades: colors.violet,
  booster: {
    multiplier: 1.3,
    rampDuration: 200,
    duration: 3000,
    cooldown: 1000,
    recharge,
    charges: 1,
  },
  model: [
    {
      color: colors.violet[0],
      lineWidth: 1.5,
      points: Array.from({ length: 26 }, (_, index) => {
        const angle =
          ((index % 13) * Math.PI) / 12 +
          (index < 13 ? -Math.PI / 2 : Math.PI / 2);

        return [
          Math.cos(angle) * 4.25 + (index < 13 ? 6 : -6),
          Math.sin(angle) * 4.25,
        ];
      }),
    },
    ...[-6, 0, 6].map((x, index) => ({
      outline: false,
      color: colors.violet[2],
      rechargeDelay: ((index * 2 + 1) * recharge) / 7,
      glow: {
        offset: [x, 0] as [number, number],
        radius: 2.5,
        alpha: 0.3,
        stops: [
          [0, colors.violet[2]],
          [0.3, colors.violet[2], 0.5],
          [1, colors.black[0], 0],
        ] as [number, string, number?][],
      },
    })),
  ],
} satisfies ModuleSpec;
