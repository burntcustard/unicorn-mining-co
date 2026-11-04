import type { ModuleId } from '../modules';
import type { MountPointSpec } from '../mounts';

export type HullSegmentSpecification = {
  health: number;
  points: number[][];
  // Bevel is the default; miter preserves points and round softens corners.
  lineJoin?: CanvasLineJoin;
  // An endpoint may include one quadratic or two cubic incoming control points.
  curvePoints?: number[][];
  cutouts?: number[][][];
  collisionParts?: number[][][];
  shades?: readonly string[];
  color?: string;
  decorations?: { points: number[][]; color: string; outline?: boolean }[];
  connections?: number[];
  essential?: boolean;
  // Join animated rectangular sections into one smooth visible ribbon.
  ribbon?: boolean;
  animation?: {
    pivot: number[];
    amplitude: number;
    phase: number;
    parent?: number;
  };
  core?: boolean;
  mounts?: MountPointSpec[][];
};

export type ShipSpec = {
  name: string;
  npcOnly?: boolean;
  crystalWeapon?: {
    emitters: { hullIndex: number; position: number[] }[];
    junction: number[];
    damage: number;
    reach: number;
    powerFiring: number;
  };
  fuelCapacity: number;
  cargoSpace: number;
  drag: number;
  mass: number;
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
