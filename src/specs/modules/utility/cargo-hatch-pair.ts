import type { ModuleSpec } from '../types';
import { cargoHatch } from './cargo-hatch';

export const cargoHatchPair = {
  ...cargoHatch,
  name: 'Cargo Hatch Pair',
  description: 'Open two center-split doors to collect loose ore and cargo.',
  offset: 0,
  model: [cargoHatch.model[0], cargoHatch.model[0], cargoHatch.model[1]],
  cargoGeometry: {
    ...cargoHatch.cargoGeometry,
    paired: true,
    length: cargoHatch.cargoGeometry.length / 2,
    openAngle: Math.PI / 2,
    doorRadius: 16,
    // Reach past the paired cannons so their barrels cannot push cargo away.
    throatRadius: 40,
  },
} satisfies ModuleSpec;
