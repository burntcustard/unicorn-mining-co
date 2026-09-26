import { Item } from './item';
import { colors } from '../colors';
import { createPolygon } from '../polygon';

// Amethyst
// A hexagonal crystal seen end on, part filled the way the diamond is so that
// it reads as a stone with depth in it
export class Amethyst extends Item {
  static resource = 1;
  static bounciness = 0.2;
  static fillAlpha = 6;
  static health = 100;
  static label = 'AMETHYST';
  static points = createPolygon({ pointCount: 6, radius: 7 });
  static price = 45;
  static shades = colors.violet;
  static glint = true;
}
