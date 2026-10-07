import { shield } from './shield';
import type { ModuleSpec } from './types';

export const shieldGeneratorSm = {
  ...shield,
  name: 'Shield Generator sm',
  price: 900,
  shieldRadius: 50,
} satisfies ModuleSpec;
