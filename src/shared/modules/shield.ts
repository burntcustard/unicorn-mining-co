import { colors } from '../colors';
import { Module } from './module';

export class Shield extends Module {
  static shades = colors.violet;
  static bounciness = 0.4;
  static health = 40;
  static label = 'SHIELD';
  static model: any[] = [
    { radius: () => 7 },
    {
      activationDuration: 0.2,
      covers: true,
      radius: ({ activationProgress }: { activationProgress: number }) =>
        50 * activationProgress,
      fillAlpha: 2,
    },
  ];
  static price = 900;
  static unhurtWhen = 1;
  static zIndex = 1;
}
