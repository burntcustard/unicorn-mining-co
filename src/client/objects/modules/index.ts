import { Laser, LaserTurret } from './laser';
import {
  PlasmaAccelerator,
  Autogun,
  CannonSm,
  PlasmaAcceleratorTurret,
  AutogunTurret,
} from './weapon';
import {
  moduleIds,
  powerPlantIds,
  type ModuleId,
} from '../../../specs/modules/index';
import { Module } from './module';
import { PowerPlant } from './power-plant';
import { FlightMode } from './flight-mode';
import { ThrustBooster } from './thrust-booster';

export { PowerPlant } from './power-plant';

import { CargoHatch, CargoHatchPair } from './cargo-hatch';
import { SearchLight } from './search-light';
import { HornDrill } from './horn-drill';
import {
  ShieldGenerator,
  ShieldGeneratorMd,
  ShieldGeneratorXs,
  ShieldGeneratorLg,
} from './shield-generator';
import {
  ThrusterSingleMd,
  ThrusterSingleSm,
  ThrusterCrescent,
  ThrusterSingleLg,
  ThrusterSingleXl,
  ThrusterDualSm,
  ThrusterDualMd,
  ThrusterDualLg,
  ThrusterDualXl,
  ThrusterTriple,
} from './thruster';

const powerPlants = powerPlantIds.map((id) => PowerPlant.define(id));

export {
  FlightMode,
  ThrustBooster,
  PlasmaAcceleratorTurret,
  AutogunTurret,
  LaserTurret,
  PlasmaAccelerator,
  Autogun,
  CannonSm,
  Laser,
  CargoHatch,
  CargoHatchPair,
  SearchLight,
  HornDrill,
  ShieldGenerator,
  ShieldGeneratorMd,
  ShieldGeneratorXs,
  ShieldGeneratorLg,
  ThrusterSingleMd,
  ThrusterSingleSm,
  ThrusterCrescent,
  ThrusterSingleLg,
  ThrusterSingleXl,
  ThrusterDualSm,
  ThrusterDualMd,
  ThrusterDualLg,
  ThrusterDualXl,
  ThrusterTriple,
};
export { cargoHatchOpen } from './cargo-hatch';
export const thrusters = [
  ThrusterSingleSm,
  ThrusterCrescent,
  ThrusterSingleMd,
  ThrusterSingleLg,
  ThrusterSingleXl,
  ThrusterDualSm,
  ThrusterDualMd,
  ThrusterDualLg,
  ThrusterDualXl,
  ThrusterTriple,
];
export const moduleTypesById = new Map<ModuleId, typeof Module>(
  [
    ...thrusters,
    CargoHatch,
    SearchLight,
    HornDrill,
    ShieldGenerator,
    ShieldGeneratorMd,
    ShieldGeneratorXs,
    ShieldGeneratorLg,
    PlasmaAccelerator,
    Autogun,
    Laser,
    ...powerPlants,
    CannonSm,
    CargoHatchPair,
    PlasmaAcceleratorTurret,
    AutogunTurret,
    LaserTurret,
    FlightMode,
    ThrustBooster,
  ].map((Type) => [Type.definitionId, Type]),
);
export const moduleTypes = moduleIds.map((id) => moduleTypesById.get(id)!);
export const PowerPlant2E = moduleTypesById.get('powerPlant2E')!;
