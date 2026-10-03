import { diamond } from './diamond';
import { amethyst } from './amethyst';
import { gold } from './gold';
import { opal } from './opal';
import { message } from './message';

export { diamond, amethyst, gold, opal, message };
export const itemIds = [
  'diamond',
  'amethyst',
  'gold',
  'opal',
  'message',
] as const;

export type ItemId = (typeof itemIds)[number];
export const itemDefinitions = { diamond, amethyst, gold, opal, message };

export const itemTypes = Object.values(itemDefinitions);
