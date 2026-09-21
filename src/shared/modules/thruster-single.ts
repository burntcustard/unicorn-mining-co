import { Thruster } from './thruster';

export class ThrusterSingle extends Thruster {
  static health = 15;
  static label = 'THRUSTERS *1 XL';
  static model: any[] = [{ flareSize: 7, thrusterNozzleSide: 0 }];
  static price = 200;
  static forwardThrust = 22;
  static rotationalThrust = 14;
  static zIndex = -1;
}
