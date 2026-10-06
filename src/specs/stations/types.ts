import type { MountPointSpec } from '../mounts';
import type { RenderingLayer } from '../rendering-layers';

export type StationSpec = {
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
