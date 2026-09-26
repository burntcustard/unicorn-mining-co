import { Module } from './module';
import { colors } from '../colors';

export class ThrusterTriple extends Module {
  static shades = colors.violet;
  static disablePhysics = true;
  static health = 30;
  static label = 'THRUSTERS *3';
  static offset = 14;
  static model: any[] = [
    { flareSize: 3, thrusterNozzleSide: -1 },
    { flareSize: 5, thrusterNozzleSide: 0 },
    { flareSize: 3, thrusterNozzleSide: 1 },
  ];
  static price = 1800;
  static forwardThrust = 28;
  static rotationalThrust = 24;
  static zIndex = -1;
}
