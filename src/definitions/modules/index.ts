import { thrusterSingle } from './thruster-single';
import { thrusterDualMd } from './thruster-dual-md';
import { thrusterDualXl } from './thruster-dual-xl';
import { thrusterTriple } from './thruster-triple';
import { cargoHatch } from './cargo-hatch';
import { searchLight } from './search-light';
import { hornDrill } from './horn-drill';
import { shieldGenerator } from './shield-generator';

export {
  thrusterSingle,
  thrusterDualMd,
  thrusterDualXl,
  thrusterTriple,
  cargoHatch,
  searchLight,
  hornDrill,
  shieldGenerator,
};
export const moduleIds = [
  'thrusterSingle',
  'thrusterDualMd',
  'thrusterDualXl',
  'thrusterTriple',
  'cargoHatch',
  'searchLight',
  'hornDrill',
  'shieldGenerator',
] as const;

export type ModuleId = (typeof moduleIds)[number];

export const moduleDefinitions = {
  thrusterSingle,
  thrusterDualMd,
  thrusterDualXl,
  thrusterTriple,
  cargoHatch,
  searchLight,
  hornDrill,
  shieldGenerator,
};

export const moduleDefinitionList = Object.values(moduleDefinitions);
