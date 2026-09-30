import { Item } from './item';
import { itemDefaults, itemSpecifications } from '../specification/items';

// Amethyst
// A hexagonal crystal seen end on, part filled the way the diamond is so that
// it reads as a stone with depth in it
const specification = itemSpecifications.amethyst;

export class Amethyst extends Item {
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
