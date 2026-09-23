import { GameObject } from '../game-object';
import { radiusOf } from '../polygon';
import { collisionCategories, type Collider } from '../collision/types';

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

  hitboxes(): Collider[] {
    const body = super.hitboxes();

    return body.length
      ? [
          ...body,
          {
            owner: this,
            position: this.position,
            radius: 0,
            rotation: this.rotation,
            physics: false,
            pickupPoint: true,
            collisionCategory: collisionCategories.pickupPoint,
            collisionMask: collisionCategories.scoopMouth,
          },
        ]
      : body;
  }
}
