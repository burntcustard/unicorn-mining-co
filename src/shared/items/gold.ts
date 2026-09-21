import { Item } from './item';
import { colors } from '../colors';

// Gold
// The same ingot as the platinum, cut shorter and squarer, with a line along
// the top face so the two are told apart at a glance as well as by colour
export class Gold extends Item {
  static resource = 2;
  static bounciness = 0.1;
  static health = 100;
  static lines = [
    [
      [-5, -1],
      [5, -1],
    ],
  ];
  static label = 'GOLD';
  static points = [
    [-7, -4],
    [7, -4],
    [5, 3],
    [-5, 3],
  ];
  static price = 30;
  static shades = colors.yellow;
  static glint = true;
}
