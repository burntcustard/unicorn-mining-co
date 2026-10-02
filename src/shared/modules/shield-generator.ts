import { moduleSpecifications } from '../specification/modules';
import { Module } from './module';

const specification = moduleSpecifications.shieldGenerator;

export class ShieldGenerator extends Module {
  static shades = specification.shades;
  static bounciness = specification.bounciness;
  static health = specification.health;
  static label = specification.label;
  static model: any[] = [
    { radius: () => specification.generatorRadius },
    {
      activationDuration: specification.coverDuration,
      covers: true,
      radius: ({ activationProgress }: { activationProgress: number }) =>
        specification.shieldRadius * activationProgress,
      fillAlpha: 2,
    },
  ];
  static price = specification.price;
  static unhurtWhen = specification.unhurtWhen;
  static zIndex = specification.zIndex;
}
