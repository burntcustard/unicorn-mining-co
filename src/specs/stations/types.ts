import type { MountPointSpec } from '../mounts';
import type { RenderingLayer } from '../rendering-layers';
import type { ItemId } from '../items';

export type StationSpec = {
  name: string;
  initialCargoContents: { item: ItemId; count: number }[];
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
