import type { ShipSpec } from './types';
import { mustang } from './mustang';
import { arrow } from './arrow';
import { crotus } from './crotus';
import { courser } from './courser';
import { moth } from './moth';
import { finch } from './finch';
import { kestrel } from './kestrel';
import { crescent } from './crescent';
import { crystal } from './crystal';
import { manta } from './manta';

export const shipSpecs = {
  mustang,
  arrow,
  crotus,
  courser,
  moth,
  finch,
  kestrel,
  crescent,
  crystal,
  manta,
};

export type ShipId = keyof typeof shipSpecs;

export const shipSpecsById = new Map<ShipId, ShipSpec>(
  Object.entries(shipSpecs) as [ShipId, ShipSpec][],
);
