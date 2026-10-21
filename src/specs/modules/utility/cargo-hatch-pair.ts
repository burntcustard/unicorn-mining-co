import type { ModuleSpec } from '../types';
import { cargoHatch } from './cargo-hatch';

export const cargoHatchPair = {
  ...cargoHatch,
  name: 'Cargo Hatch Pair',
  description: 'Open two center-split doors to collect loose ore and cargo.',
  offset: 0,
  collisionMargin: 0,
  model: [
    cargoHatch.model[0],
    cargoHatch.model[0],
    {
      ...cargoHatch.model[1],
      // Collect behind the door hinges, after cargo passes the visible doors.
      points: [
        [-8, -6],
        [-2, -6],
        [-2, 6],
        [-8, 6],
      ],
    },
  ],
  cargoGeometry: {
    ...cargoHatch.cargoGeometry,
    paired: true,
    length: cargoHatch.cargoGeometry.length / 2,
    openAngle: Math.PI / 2,
    doorRadius: 16,
    throatRadius: 10,
  },
} satisfies ModuleSpec;
