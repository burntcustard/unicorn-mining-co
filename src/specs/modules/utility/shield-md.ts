import { shield } from './shield';
import type { ModuleSpec } from '../types';

export const shieldGeneratorMd = {
  ...shield,
  name: `${shield.name} md`,
  health: 30,
  healthActivated: 40,
  power: 0.4,
  powerActivated: 1.4,
  price: 1200,
  shieldRadius: 60,
} satisfies ModuleSpec;
