import { Ship } from './ship';
import { ThrusterDualMd, CargoScoop, Horn, Light } from '../modules';

export const fitStarterModules = (ship: Ship) => {
  [ThrusterDualMd, CargoScoop, CargoScoop, Horn, Light].forEach((Type) =>
    ship.fit(new Type()),
  );
};
