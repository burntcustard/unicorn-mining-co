import { Item } from './item';
import { colors } from '../colors';

// Message
// A data slate drawn as a tablet with two lines of writing. Its spawner
// supplies the field coordinates; every slate can also unlock orange paint.

export class Message extends Item {
  declare message: string;
  declare unlock: string;
  static unlock = 'ORANGE';
  static resource = 4;
  static bounciness = 0.2;
  static health = 100;
  static lines = [
    [
      [-4, -1],
      [4, -1],
    ],
    [
      [-4, 2],
      [2, 2],
    ],
  ];
  static points = [
    [-7, -5],
    [7, -5],
    [7, 5],
    [-7, 5],
  ];
  static shades = colors.orange;
}
