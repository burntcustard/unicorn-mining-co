import { GameObject } from './game-object';
import { radiusOf } from '../utilities/polygon';
import { type Collider } from '../collision/types';
import { cargoPickupPoint } from './modules/cargo-hatch';
import { itemDefaults } from '../../definitions/items/defaults';
import type { ItemDefinition } from '../../definitions/items/types';

export class Item extends GameObject {
  kind = 'item' as const;
  declare resource: number;
  constructor(
    definition: ItemDefinition,
    properties: ConstructorParameters<typeof GameObject>[0] = {},
  ) {
    super({ ...itemDefaults, ...definition, ...properties });
    this.item = definition;
    this.shapeOutline = this.points;

    if (this.shapeOutline) this.radius = radiusOf(this.shapeOutline);
  }

  hitbox(): Collider[] {
    const body = super.hitbox();

    return body.length ? [...body, cargoPickupPoint(this)] : body;
  }
}
