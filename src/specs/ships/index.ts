import type { ShipSpec } from './types';
import { mustang } from './mustang';
import { arrow } from './arrow';
import { crotus } from './crotus';

export { mustang, arrow, crotus };
export const shipIds = ['mustang', 'arrow', 'crotus'] as const;

export type ShipId = (typeof shipIds)[number];
export const shipSpecs = { mustang, arrow, crotus };

export const shipSpecList = Object.values(shipSpecs);
export const shipSpecsById = new Map<ShipId, ShipSpec>(
  shipIds.map((id) => [id, shipSpecs[id]]),
);
