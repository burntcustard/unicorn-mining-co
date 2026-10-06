import type { ModuleId } from '../modules';
import type { MountPointSpec } from '../mounts';

type HullSegmentSpecification = {
  health: number;
  points: number[][];
  core?: boolean;
  mounts?: MountPointSpec[][];
};

export type ShipSpec = {
  name: string;
  cargoSpace: number;
  drag: number;
  mass: number;
  radius: number;
  turnRate: number;
  // Zero-based mount slots, flattened in hull segment order. Omitted slots stay empty.
  initialLoadout: { mount: number; module: ModuleId }[];
  hullSegments: HullSegmentSpecification[];
};
