import { Thruster } from './thruster';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 6;
const offset = 11;

export class ThrusterDualXl extends Thruster {
  static health = 25;
  static label = 'THRUSTERS *2 XL';
  static offset = offset;
  static model: any[] = [
    { flareSize: size, thrusterNozzleSide: -1 },
    { flareSize: size, thrusterNozzleSide: 1 },
  ];
  static price = 800;
  static forwardThrust = 22;
  static rotationalThrust = 24;
  static zIndex = -1;
}
