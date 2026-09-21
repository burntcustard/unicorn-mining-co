export type ModuleState = {
  id?: number;
  type: number;
  mount: number;
  health?: number;
  shades?: readonly string[];
  parts: { active: number; activationProgress: number }[];
};
