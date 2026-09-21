export const approach = (value: number, target: number, step: number) =>
  value + Math.max(-step, Math.min(step, target - value));
