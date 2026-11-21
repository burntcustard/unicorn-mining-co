import type { MountPointSpec } from '../mounts';
import type { RenderingLayer } from '../rendering-layers';
import type { ShipId } from '../ships';

export type ShipOffer = { ship: ShipId; price: number };

export type StationSpec = {
  name: string;
  dockingBays: number[];
  hullSegments: {
    points: number[][];
    mounts?: MountPointSpec[][];
    disablePhysics?: boolean;
    dockSegment?: boolean;
    shades?: readonly string[];
    zIndex?: RenderingLayer;
    fillAlpha?: number;
    glow?: number[][];
    unclosed?: boolean;
  }[];
  localMovementRadius: number;
  mass: number;
  zIndex: RenderingLayer;
};
