import { Ship } from './ship';
import { ThrusterDualMd, CargoHatch, HornDrill, SearchLight } from '../modules';

export const fitStarterModules = (ship: Ship) => {
  [ThrusterDualMd, CargoHatch, CargoHatch, HornDrill, SearchLight].forEach(
    (Type) => ship.fit(new Type()),
  );
};
