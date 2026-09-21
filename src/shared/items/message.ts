import { Item } from './item';
import { colors } from '../colors';

// Message
// A data slate drawn as a tablet with two lines of writing. Its spawner
// supplies the message, pointing to a resource field or unlocking paint.

export class Message extends Item {
  static resource = 4;
  static bounciness = 0.1;
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
