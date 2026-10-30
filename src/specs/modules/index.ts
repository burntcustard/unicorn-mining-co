import * as core from './core';
import * as offense from './offense';
import * as utility from './utility';
import type { ModuleCategory } from './categories';
import type { ModuleSpec } from './types';

const categorize = <
  Category extends ModuleCategory,
  Specs extends Record<string, ModuleSpec>,
>({
  category,
  specs,
}: {
  category: Category;
  specs: Specs;
}) =>
  Object.fromEntries(
    Object.entries(specs).map(([id, spec]) => [id, { ...spec, category }]),
  ) as unknown as { [Id in keyof Specs]: Specs[Id] & { category: Category } };

const {
  powerPlant,
  thrusterSingleSm,
  thrusterSingleMd,
  thrusterSingleLg,
  thrusterSingleXl,
  thrusterDualSm,
  thrusterDualMd,
  thrusterDualLg,
  thrusterDualXl,
  thrusterTriple,
} = categorize({ category: 'core', specs: core });

const {
  autogun,
  laser,
  plasmaAccelerator,
  hornDrill,
  cannonSm,
  autogunTurret,
  plasmaAcceleratorTurret,
  laserTurret,
} = categorize({ category: 'offense', specs: offense });

const {
  cargoHatch,
  cargoHatchPair,
  searchLight,
  shieldGeneratorSm,
  shieldGeneratorMd,
  shieldGeneratorXs,
  shieldGeneratorLg,
} = categorize({ category: 'utility', specs: utility });

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
  laser,
  powerPlant,
  cannonSm,
  cargoHatchPair,
  shieldGeneratorXs,
  shieldGeneratorLg,
  autogunTurret,
  plasmaAcceleratorTurret,
  laserTurret,
  thrusterDualSm,
};
// Stable wire IDs: folder and category order must not change these indexes.
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
  'laser',
  'powerPlant',
  'cannonSm',
  'cargoHatchPair',
  'shieldGeneratorXs',
  'shieldGeneratorLg',
  'autogunTurret',
  'plasmaAcceleratorTurret',
  'laserTurret',
  'thrusterDualSm',
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
  laser,
  powerPlant,
  cannonSm,
  cargoHatchPair,
  shieldGeneratorXs,
  shieldGeneratorLg,
  autogunTurret,
  plasmaAcceleratorTurret,
  laserTurret,
  thrusterDualSm,
};

export const moduleSpecList = Object.values(moduleSpecs);

export type WeaponId = {
  [Id in ModuleId]: (typeof moduleSpecs)[Id]['behavior'] extends 'weapon'
    ? Id
    : never;
}[ModuleId];

// Stations offer these modules; NPC equipment remains in the full catalog.
export const stationModuleIds: readonly ModuleId[] = [
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
  'laser',
  'powerPlant',
  'shieldGeneratorXs',
  'shieldGeneratorLg',
  'autogunTurret',
  'plasmaAcceleratorTurret',
  'laserTurret',
  'thrusterDualSm',
];
