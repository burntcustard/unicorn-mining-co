import { colors } from '../colors';
import { Module } from './module';

export class Horn extends Module {
  static shades = colors.yellow;
  static activationDuration = 0.5;
  static bounciness = (segment: any) =>
    segment.activationProgress > 0.5 ? -0.2 : 0;
  static damage = 0.5;
  static grinds = true;
  static health = 100;
  static model: any[] = [
    {
      points: [
        [3, -6],
        [27, 0],
        [3, 6],
      ],
    },
  ];
  static label = 'DRILL';
  static price = 350;
  static zIndex = -1;
}
