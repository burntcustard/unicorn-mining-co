import { GameObject } from '../game-object';
import { radiusOf } from '../polygon';
import { type Collider } from '../collision/types';
import { cargoPickupPoint } from '../modules/cargo-hatch';
import { itemDefaults } from '../specification/items';

export class Item extends GameObject {
  static [key: string]: any;
  static mass = itemDefaults.mass;
  static angularDrag = itemDefaults.angularDrag;
  static radius: number = itemDefaults.radius;
  kind = 'item' as const;
  declare resource: number;
  constructor(properties: ConstructorParameters<typeof GameObject>[0] = {}) {
    super(properties);
    this.item = this.constructor;
    this.shapeOutline = this.points;

    if (this.shapeOutline) this.radius = radiusOf(this.shapeOutline);
  }

  hitbox(): Collider[] {
    const body = super.hitbox();

    return body.length ? [...body, cargoPickupPoint(this)] : body;
  }
}
