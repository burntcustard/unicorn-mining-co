import { Item } from './item';
import { colors } from '../colors';

// Opal
// Round rather than cut, so it brings a radius instead of a shape outline and is
// collided with as the circle it is
export class Opal extends Item {
  static resource = 3;
  static bounciness = 0.2;
  static health = 100;
  static label = 'OPAL';
  static price = 45;
  static radius = 6;
  static rainbow = true;
  static shades = colors.white;
  static glint = true;
}
