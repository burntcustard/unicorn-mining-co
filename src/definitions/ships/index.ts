import type { ShipDefinition } from './types';
import { mustang } from './mustang';

export { mustang };
export const shipIds = ['mustang'] as const;
export type ShipId = (typeof shipIds)[number];
export const shipDefinitions = { mustang };

export const shipDefinitionList = Object.values(shipDefinitions);
export const shipDefinitionsById = new Map<ShipId, ShipDefinition>([
  ['mustang', mustang],
]);
