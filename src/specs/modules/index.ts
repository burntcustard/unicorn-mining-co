import { plasmaAccelerator } from './plasma-accelerator';
import { autogun } from './autogun';
import { thrusterSingleMd } from './thruster-x1-md';
import { thrusterSingleSm } from './thruster-x1-sm';
import { thrusterSingleLg } from './thruster-x1-lg';
import { thrusterSingleXl } from './thruster-x1-xl';
import { thrusterDualLg } from './thruster-x2-lg';
import { thrusterDualMd } from './thruster-x2-md';
import { thrusterDualXl } from './thruster-x2-xl';
import { thrusterTriple } from './thruster-x3';
import { cargoHatch } from './cargo-hatch';
import { searchLight } from './search-light';
import { hornDrill } from './horn-drill';
import { shieldGeneratorSm } from './shield-sm';
import { shieldGeneratorMd } from './shield-md';

export {
  thrusterSingleMd,
  thrusterDualMd,
  thrusterDualXl,
  thrusterTriple,
  cargoHatch,
  searchLight,
  hornDrill,
  shieldGeneratorSm,
  shieldGeneratorMd,
  thrusterSingleSm,
  thrusterSingleLg,
  thrusterSingleXl,
  plasmaAccelerator,
  autogun,
  thrusterDualLg,
};
export const moduleIds = [
  'thrusterSingleMd',
  'thrusterDualMd',
  'thrusterDualXl',
  'thrusterTriple',
  'cargoHatch',
  'searchLight',
  'hornDrill',
  'shieldGeneratorSm',
  'shieldGeneratorMd',
  'thrusterSingleSm',
  'thrusterSingleLg',
  'thrusterSingleXl',
  'plasmaAccelerator',
  'autogun',
  'thrusterDualLg',
] as const;

export type ModuleId = (typeof moduleIds)[number];

export const moduleSpecs = {
  thrusterSingleMd,
  thrusterDualMd,
  thrusterDualXl,
  thrusterTriple,
  cargoHatch,
  searchLight,
  hornDrill,
  shieldGeneratorSm,
  shieldGeneratorMd,
  thrusterSingleSm,
  thrusterSingleLg,
  thrusterSingleXl,
  plasmaAccelerator,
  autogun,
  thrusterDualLg,
};

export const moduleSpecList = Object.values(moduleSpecs);

export type WeaponId = {
  [Id in ModuleId]: (typeof moduleSpecs)[Id]['behavior'] extends 'weapon'
    ? Id
    : never;
}[ModuleId];
