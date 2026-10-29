import { Laser, LaserTurret } from './laser';
import {
  PlasmaAccelerator,
  Autogun,
  CannonSm,
  PlasmaAcceleratorTurret,
  AutogunTurret,
} from './weapon';
import { moduleIds, type ModuleId } from '../../../specs/modules/index';
import { Module } from './module';

export const PowerPlant = Module.define('powerPlant');

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
  ThrusterSingleLg,
  ThrusterSingleXl,
} from './thruster';
import { ThrusterDualLg } from './thruster';
import { ThrusterDualMd } from './thruster';
import { ThrusterDualXl } from './thruster';
import { ThrusterTriple } from './thruster';

export {
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
  ThrusterSingleLg,
  ThrusterSingleXl,
  ThrusterDualMd,
  ThrusterDualLg,
  ThrusterDualXl,
  ThrusterTriple,
};
export { cargoHatchOpen } from './cargo-hatch';
export const thrusters = [
  ThrusterSingleSm,
  ThrusterSingleMd,
  ThrusterSingleLg,
  ThrusterSingleXl,
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
    PowerPlant,
    CannonSm,
    CargoHatchPair,
    PlasmaAcceleratorTurret,
    AutogunTurret,
    LaserTurret,
  ].map((Type) => [Type.definitionId, Type]),
);
export const moduleTypes = moduleIds.map((id) => moduleTypesById.get(id)!);
