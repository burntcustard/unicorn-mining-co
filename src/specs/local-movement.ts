export const motion = {
  defaultDrag: 0.15,
  defaultMaxSpeed: 272,
  maxSpeedDrag: 0.9,
  minimumSpeedSquared: 1,
  // Damped spin can stall above zero on the motion grid.
  minimumSpin: 0.0001,
} as const;
