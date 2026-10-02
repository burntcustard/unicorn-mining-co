import { Item } from './item';
import { itemDefaults, itemSpecifications } from '../specification/items';

// Opal
// Round rather than cut, so it brings a radius instead of a shape outline and is
// collided with as the circle it is
const specification = itemSpecifications.opal;

export class Opal extends Item {
  static resource = specification.resource;
  static label = specification.label;
  static price = specification.price;
  static radius = specification.radius;
  static shades = specification.shades;
  static glint = specification.glint;
  static rainbow = specification.rainbow;
  static bounciness = itemDefaults.bounciness;
  static health = itemDefaults.health;
}
