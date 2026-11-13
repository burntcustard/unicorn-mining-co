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
  powerPlant2V,
  powerPlant1A,
  powerPlant1H,
  powerPlant1V,
  powerPlant1L,
  powerPlant2A,
  powerPlant2H,
  powerPlant2L,
  powerPlant3A,
  powerPlant3H,
  powerPlant3V,
  powerPlant3L,
  powerPlant4A,
  powerPlant4H,
  powerPlant4V,
  powerPlant4L,
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
  powerPlant2V,
  cannonSm,
  cargoHatchPair,
  shieldGeneratorXs,
  shieldGeneratorLg,
  autogunTurret,
  plasmaAcceleratorTurret,
  laserTurret,
  thrusterDualSm,
  powerPlant1A,
  powerPlant1H,
  powerPlant1V,
  powerPlant1L,
  powerPlant2A,
  powerPlant2H,
  powerPlant2L,
  powerPlant3A,
  powerPlant3H,
  powerPlant3V,
  powerPlant3L,
  powerPlant4A,
  powerPlant4H,
  powerPlant4V,
  powerPlant4L,
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
  'powerPlant2V',
  'cannonSm',
  'cargoHatchPair',
  'shieldGeneratorXs',
  'shieldGeneratorLg',
  'autogunTurret',
  'plasmaAcceleratorTurret',
  'laserTurret',
  'thrusterDualSm',
  'powerPlant1A',
  'powerPlant1H',
  'powerPlant1V',
  'powerPlant1L',
  'powerPlant2A',
  'powerPlant2H',
  'powerPlant2L',
  'powerPlant3A',
  'powerPlant3H',
  'powerPlant3V',
  'powerPlant3L',
  'powerPlant4A',
  'powerPlant4H',
  'powerPlant4V',
  'powerPlant4L',
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
  powerPlant2V,
  cannonSm,
  cargoHatchPair,
  shieldGeneratorXs,
  shieldGeneratorLg,
  autogunTurret,
  plasmaAcceleratorTurret,
  laserTurret,
  thrusterDualSm,
  powerPlant1A,
  powerPlant1H,
  powerPlant1V,
  powerPlant1L,
  powerPlant2A,
  powerPlant2H,
  powerPlant2L,
  powerPlant3A,
  powerPlant3H,
  powerPlant3V,
  powerPlant3L,
  powerPlant4A,
  powerPlant4H,
  powerPlant4V,
  powerPlant4L,
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
  'cargoHatchPair',
  'cannonSm',
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
  'powerPlant2V',
  'shieldGeneratorXs',
  'shieldGeneratorLg',
  'autogunTurret',
  'plasmaAcceleratorTurret',
  'laserTurret',
  'thrusterDualSm',
  'powerPlant1A',
  'powerPlant1H',
  'powerPlant1V',
  'powerPlant1L',
  'powerPlant2A',
  'powerPlant2H',
  'powerPlant2L',
  'powerPlant3A',
  'powerPlant3H',
  'powerPlant3V',
  'powerPlant3L',
  'powerPlant4A',
  'powerPlant4H',
  'powerPlant4V',
  'powerPlant4L',
];

// Each power plant mount accepts all four ratings of its assigned size.
export const powerPlantIdsBySize: Record<1 | 2 | 3 | 4, ModuleId[]> = {
  1: ['powerPlant1A', 'powerPlant1H', 'powerPlant1V', 'powerPlant1L'],
  2: ['powerPlant2A', 'powerPlant2H', 'powerPlant2V', 'powerPlant2L'],
  3: ['powerPlant3A', 'powerPlant3H', 'powerPlant3V', 'powerPlant3L'],
  4: ['powerPlant4A', 'powerPlant4H', 'powerPlant4V', 'powerPlant4L'],
};

export const powerPlantIds = Object.values(powerPlantIdsBySize).flat();
