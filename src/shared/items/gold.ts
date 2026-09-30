import { Item } from './item';
import { itemDefaults, itemSpecifications } from '../specification/items';

// Gold
// The same ingot as the platinum, cut shorter and squarer, with a line along
// the top face so the two are told apart at a glance as well as by colour
const specification = itemSpecifications.gold;

export class Gold extends Item {
  static resource = specification.resource;
  static label = specification.label;
  static price = specification.price;
  static points = specification.points;
  static lines = specification.lines;
  static shades = specification.shades;
  static glint = specification.glint;
  static bounciness = itemDefaults.bounciness;
  static health = itemDefaults.health;
}
