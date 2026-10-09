import { shieldGeneratorName } from './names';
import { shield } from './shield';
import type { ModuleSpec } from './types';

export const shieldGeneratorMd = {
  ...shield,
  name: `${shieldGeneratorName} md`,
  price: 1200,
  shieldRadius: 60,
} satisfies ModuleSpec;
