import { Item } from './item';
import { itemDefaults, itemSpecifications } from '../specification/items';

// Message
// A data slate drawn as a tablet with two lines of writing. Its spawner
// supplies the field coordinates; every slate can also unlock orange paint.

const specification = itemSpecifications.message;

export class Message extends Item {
  declare message: string;
  declare unlock: string;
  static resource = specification.resource;
  static points = specification.points;
  static lines = specification.lines;
  static shades = specification.shades;
  static unlock = specification.unlock;
  static bounciness = itemDefaults.bounciness;
  static health = itemDefaults.health;
}
