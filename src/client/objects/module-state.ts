export type ModuleState = {
  id?: number;
  type: number;
  mount: number;
  health?: number;
  shades?: readonly string[];
  segments: { active: number; activationProgress: number }[];
};
