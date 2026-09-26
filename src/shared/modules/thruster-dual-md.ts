import { Module } from './module';
import { colors } from '../colors';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 4;
const offset = 10;

export class ThrusterDualMd extends Module {
  static shades = colors.violet;
  static disablePhysics = true;
  static health = 20;
  static label = 'THRUSTERS *2';
  static offset = offset;
  static model: any[] = [
    { flareSize: size, thrusterNozzleSide: -1 },
    { flareSize: size, thrusterNozzleSide: 1 },
  ];
  static price = 350;
  static forwardThrust = 16;
  static rotationalThrust = 16;
  static zIndex = -1;
}
