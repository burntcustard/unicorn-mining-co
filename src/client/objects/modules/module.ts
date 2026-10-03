import { GameObject } from '../game-object';

export class Module extends GameObject {
  static [key: string]: any;
  static model: any[] = [];
  declare model: any[];
  declare label: string;
  declare health: number;
  declare mount: any;
}
