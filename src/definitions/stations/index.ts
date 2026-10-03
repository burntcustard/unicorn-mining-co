import type { StationDefinition } from './types';
import { corral } from './corral';

export { corral };
export const stationDefinitions = { corral };

export type StationId = keyof typeof stationDefinitions;

export const stationDefinitionList = Object.values(stationDefinitions);
export const stationDefinitionsById = new Map<StationId, StationDefinition>([
  ['corral', corral],
]);
