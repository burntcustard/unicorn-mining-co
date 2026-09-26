import { Item } from './item';
import { colors } from '../colors';

// Diamond
// A brilliant cut seen face on: the flat table across the top, shoulders out
// to the widest point at the girdle, and the pavilion tapering to a point
// below. Nothing but the shape outline, which at this size is all that reads anyway
export class Diamond extends Item {
  static resource = 0;
  static bounciness = 0.2;
  static fillAlpha = 6;
  static health = 100;
  static label = 'DIAMOND';
  static points = [
    [-3, -4],
    [3, -4],
    [6, -2],
    [0, 6],
    [-6, -2],
  ];
  static price = 80;
  static shades = colors.cyan;
  static glint = true;
}
