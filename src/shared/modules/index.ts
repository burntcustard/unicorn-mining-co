import { CargoScoop } from './cargo-scoop';
import { Light } from './light';
import { Horn } from './horn';
import { Shield } from './shield';
import { ThrusterSingle } from './thruster-single';
import { ThrusterDualMd } from './thruster-dual-md';
import { ThrusterDualXl } from './thruster-dual-xl';
import { ThrusterTriple } from './thruster-triple';

export {
  CargoScoop,
  Light,
  Horn,
  Shield,
  ThrusterSingle,
  ThrusterDualMd,
  ThrusterDualXl,
  ThrusterTriple,
};
export { scoopOpen } from './cargo-scoop';
export const thrusters = [
  ThrusterSingle,
  ThrusterDualMd,
  ThrusterDualXl,
  ThrusterTriple,
];
export const moduleTypes = [...thrusters, CargoScoop, Light, Horn, Shield];
