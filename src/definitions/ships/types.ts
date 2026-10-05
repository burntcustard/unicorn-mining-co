import type { ModuleId } from '../modules';

type HullSegmentSpecification = {
  health: number;
  points: number[][];
  core?: boolean;
  mounts?: { fits: ModuleId[]; localPosition: { x: number; y: number } }[];
};

export type ShipDefinition = {
  cargoSpace: number;
  drag: number;
  mass: number;
  radius: number;
  turnRate: number;
  hullSegments: HullSegmentSpecification[];
};
