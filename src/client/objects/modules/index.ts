import { PlasmaAccelerator, Autocannon } from './weapon';
import { moduleIds, type ModuleId } from '../../../specs/modules/index';
import { type Module } from './module';
import { CargoHatch } from './cargo-hatch';
import { SearchLight } from './search-light';
import { HornDrill } from './horn-drill';
import { ShieldGenerator, ShieldGeneratorMd } from './shield-generator';
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
  PlasmaAccelerator,
  Autocannon,
  CargoHatch,
  SearchLight,
  HornDrill,
  ShieldGenerator,
  ShieldGeneratorMd,
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
    PlasmaAccelerator,
    Autocannon,
  ].map((Type) => [Type.definitionId, Type]),
);
export const moduleTypes = moduleIds.map((id) => moduleTypesById.get(id)!);
