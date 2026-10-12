import { autogunAmmo } from './autogun-ammo';
import { diamond } from './diamond';
import { amethyst } from './amethyst';
import { gold } from './gold';
import { opal } from './opal';
import { message } from './message';

export { diamond, amethyst, gold, opal, message, autogunAmmo };
export const itemIds = [
  'diamond',
  'amethyst',
  'gold',
  'opal',
  'message',
  'autogunAmmo',
] as const;

export type ItemId = (typeof itemIds)[number];

export const itemSpecs = {
  diamond,
  amethyst,
  gold,
  opal,
  message,
  autogunAmmo,
};

export const itemTypes = Object.values(itemSpecs);
