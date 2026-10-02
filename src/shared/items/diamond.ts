import { Item } from './item';
import { itemDefaults, itemSpecifications } from '../specification/items';

// Diamond
// A brilliant cut seen face on: the flat table across the top, shoulders out
// to the widest point at the girdle, and the pavilion tapering to a point
// below. Nothing but the shape outline, which at this size is all that reads anyway
const specification = itemSpecifications.diamond;

export class Diamond extends Item {
  static resource = specification.resource;
  static label = specification.label;
  static price = specification.price;
  static points = specification.points;
  static fillAlpha = specification.fillAlpha;
  static shades = specification.shades;
  static glint = specification.glint;
  static bounciness = itemDefaults.bounciness;
  static health = itemDefaults.health;
}
