import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorMd = {
  ...shield,
  name: `${shield.name} md`,
  power: 0.3,
  powerActivated: 2.4,
  price: 1200,
  shieldRadius: 60,
} satisfies ModuleSpec;
