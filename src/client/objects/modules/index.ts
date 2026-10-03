import { moduleIds, type ModuleId } from '../../../definitions/modules/index';
import { type Module } from './module';
import { CargoHatch } from './cargo-hatch';
import { SearchLight } from './search-light';
import { HornDrill } from './horn-drill';
import { ShieldGenerator } from './shield-generator';
import { ThrusterSingle, thrusterTypesById } from './thruster';
import { ThrusterDualMd } from './thruster';
import { ThrusterDualXl } from './thruster';
import { ThrusterTriple } from './thruster';

export {
  CargoHatch,
  SearchLight,
  HornDrill,
  ShieldGenerator,
  ThrusterSingle,
  ThrusterDualMd,
  ThrusterDualXl,
  ThrusterTriple,
};
export { cargoHatchOpen } from './cargo-hatch';
export const thrusters = [...thrusterTypesById.values()];
export const moduleTypesById = new Map<ModuleId, typeof Module>([
  ...thrusterTypesById,
  ['cargoHatch', CargoHatch],
  ['searchLight', SearchLight],
  ['hornDrill', HornDrill],
  ['shieldGenerator', ShieldGenerator],
]);
export const moduleTypes = moduleIds.map((id) => moduleTypesById.get(id)!);
