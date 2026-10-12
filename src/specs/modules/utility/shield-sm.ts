import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorSm = {
  ...shield,
  name: `${shield.name} sm`,
  power: 0.2,
  powerActivated: 1.2,
  price: 900,
  shieldRadius: 50,
} satisfies ModuleSpec;
