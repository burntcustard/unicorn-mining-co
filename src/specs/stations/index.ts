import type { StationSpec } from './types';
import { corral } from './corral';

export { corral };
export const stationSpecs = { corral };

export type StationId = keyof typeof stationSpecs;

export const stationSpecList = Object.values(stationSpecs);
export const stationSpecsById = new Map<StationId, StationSpec>([
  ['corral', corral],
]);
