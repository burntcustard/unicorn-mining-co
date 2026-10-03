export type StationDefinition = {
  hullSegments: {
    points: number[][];
    disablePhysics?: boolean;
    dockSegment?: boolean;
    shades?: readonly string[];
    zIndex?: number;
    fillAlpha?: number;
    glow?: number[][];
    unclosed?: boolean;
  }[];
  localMovementRadius: number;
  mass: number;
  zIndex: number;
};
