import { Module } from './module';
import { moduleSpecifications } from '../specification/modules';

const specification = moduleSpecifications.thrusterTriple;

export class ThrusterTriple extends Module {
  static shades = specification.shades;
  static disablePhysics = specification.disablePhysics;
  static health = specification.health;
  static label = specification.label;
  static offset = specification.offset;
  static model: any[] = specification.flareSizes.map((flareSize, index) => ({
    flareSize,
    thrusterNozzleSide: specification.nozzleSides[index],
  }));
  static price = specification.price;
  static forwardThrust = specification.forwardThrust;
  static rotationalThrust = specification.rotationalThrust;
  static zIndex = specification.zIndex;
}
