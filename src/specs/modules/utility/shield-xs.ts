import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorXs = {
  ...shield,
  name: `${shield.name} xs`,
  power: 0.4,
  powerActivated: 1.2,
  price: 600,
  shieldRadius: 40,
} satisfies ModuleSpec;
