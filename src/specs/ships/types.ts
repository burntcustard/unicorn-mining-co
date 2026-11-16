import type { ModuleId } from '../modules';
import type { MountPointSpec } from '../mounts';

export type HullSegmentSpecification = {
  health: number;
  points: number[][];
  // Bevel is the default; miter preserves points and round softens corners.
  lineJoin?: CanvasLineJoin;
  // Optional open stroke paths, separate from the filled collision polygon.
  shapeOutline?: number[][][];
  collisionParts?: number[][][];
  shades?: readonly string[];
  connections?: number[];
  // Translation at full flight-mode activation, inherited through connections.
  flightOffset?: [number, number];
  essential?: boolean;
  core?: boolean;
  mounts?: MountPointSpec[][];
};

export type ShipSpec = {
  name: string;
  price: number;
  fuelCapacity: number;
  cargoSpace: number;
  drag: number;
  hullMass: number;
  angularThrust: number;
  radius: number;
  turnRate: number;
  // Zero-based mount slots, flattened in hull segment order. Omitted slots stay empty.
  initialLoadout: {
    mount: number;
    module: ModuleId;
    shades?: readonly string[];
  }[];
  hullSegments: HullSegmentSpecification[];
};
