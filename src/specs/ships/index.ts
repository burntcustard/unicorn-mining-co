import type { ShipSpec } from './types';
import { mustang } from './mustang';
import { arrow } from './arrow';
import { crotus } from './crotus';
import { courser } from './courser';
import { moth } from './moth';

export const shipSpecs = { mustang, arrow, crotus, courser, moth };

export type ShipId = keyof typeof shipSpecs;

export const shipSpecsById = new Map<ShipId, ShipSpec>(
  Object.entries(shipSpecs) as [ShipId, ShipSpec][],
);
