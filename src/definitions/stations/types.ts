import type { RenderingLayer } from '../rendering-layers';

export type StationDefinition = {
  hullSegments: {
    points: number[][];
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
