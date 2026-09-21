import { Module } from './module';
import { colors } from '../colors';

export class Thruster extends Module {
  static shades = colors.violet;
  static disablePhysics = true;
}
