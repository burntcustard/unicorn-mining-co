import { CargoHatch } from './cargo-hatch';
import { SearchLight } from './search-light';
import { HornDrill } from './horn-drill';
import { ShieldGenerator } from './shield-generator';
import { ThrusterSingle } from './thruster-single';
import { ThrusterDualMd } from './thruster-dual-md';
import { ThrusterDualXl } from './thruster-dual-xl';
import { ThrusterTriple } from './thruster-triple';

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
export const thrusters = [
  ThrusterSingle,
  ThrusterDualMd,
  ThrusterDualXl,
  ThrusterTriple,
];
export const moduleTypes = [
  ...thrusters,
  CargoHatch,
  SearchLight,
  HornDrill,
  ShieldGenerator,
];
