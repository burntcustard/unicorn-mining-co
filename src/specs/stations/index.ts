import type { StationSpec } from './types';
import { corral5 } from './corral-5';
import { corral6 } from './corral-6';

export { corral5, corral6 };
export const stationSpecs = { 'corral-5': corral5, 'corral-6': corral6 };

export type StationId = keyof typeof stationSpecs;

export const stationSpecList = Object.values(stationSpecs);
export const stationSpecsById = new Map<StationId, StationSpec>([
  ['corral-5', corral5],
  ['corral-6', corral6],
]);
