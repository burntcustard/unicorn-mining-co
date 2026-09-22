import { GameObject } from '../game-object';
import { radiusOf } from '../polygon';

export class Item extends GameObject {
  static [key: string]: any;
  static mass = 6;
  static angularDrag = 0.15;
  static radius = 8;
  kind = 'item' as const;
  declare resource: number;
  constructor(properties: ConstructorParameters<typeof GameObject>[0] = {}) {
    super(properties);
    this.item = this.constructor;
    this.outline = this.points;
    if (this.outline) this.radius = radiusOf(this.outline);
  }
}
