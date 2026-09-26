export type WreckageSegment = {
  shapeOutline?: number[][];
  radius: number;
  offset: { x: number; y: number };
  health: number;
  fillShade?: number;
  stroke?: number[][][];
};
