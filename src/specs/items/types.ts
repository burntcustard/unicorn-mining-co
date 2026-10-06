export type ItemSpec = {
  resource: number;
  rounds?: number;
  name: string;
  price?: number;
  points?: number[][];
  radius?: number;
  lines?: number[][][];
  shades: readonly string[];
  glint?: boolean;
  rainbow?: boolean;
  fillAlpha?: number;
  unlock?: string;
};
