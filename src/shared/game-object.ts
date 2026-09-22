import { Vector, type Vector as VectorValue } from './vector';
import { createRandom, type Random } from './seeded-random';
import { move } from './simulation/movement';
import { localMovement } from './simulation/local-movement';
import { type Collider } from './physics/collision/types';
import { type SimulationWorld } from './simulation/world';

let nextId = -1;
export class GameObject {
  [key: string]: any;
  id: number;
  position: VectorValue;
  velocity: VectorValue;
  rotation = 0;
  spin = 0;
  angularDrag = 0;
  angularInertiaScale = 1;
  mass = 0;
  radius = 0;
  dead = false;
  pendingUpdateTime = 0;
  world?: SimulationWorld;
  collections: any[][] = [];
  random: Random;
  constructor(
    properties: {
      [key: string]: any;
      id?: number;
      position?: VectorValue;
      velocity?: VectorValue;
    } = {},
  ) {
    this.id = properties.id ?? nextId--;
    this.position = properties.position || Vector();
    this.velocity = properties.velocity || Vector();
    this.random =
      properties.random ||
      properties.world?.random ||
      createRandom(this.id >>> 0);
    const definitions: Function[] = [];
    // Inherited model defaults are available before a craft builds its hull.
    // Per-instance properties, including restored state, always take priority.
    for (
      let type: any = this.constructor;
      type && type !== GameObject;
      type = Object.getPrototypeOf(type)
    )
      definitions.unshift(type);
    Object.assign(this, ...definitions, properties);
  }
  add() {
    this.dead = false;
    this.world?.entities.set(this.id, this as any);
    this.collections.forEach((list) => {
      if (!list.includes(this)) list.push(this);
    });
  }
  remove() {
    this.dead = true;
    const resident: GameObject | undefined = this.world?.entities.get(this.id);
    if (resident === this) this.world?.entities.delete(this.id);
    // Registries are shared by their members, so preserve the array identity.
    this.collections.forEach((list) => {
      const index = list.indexOf(this);
      if (index >= 0) list.splice(index, 1);
    });
  }
  hitboxes(): Collider[] {
    return this.dead || this.buried
      ? []
      : [
          {
            owner: this,
            position: this.position,
            radius: this.radius,
            rotation: this.rotation,
            outline: this.outline,
            bounciness: this.bounciness,
          },
        ];
  }
  update(dt: number) {
    if (this.dead || this.buried) return;
    if (this.decay && (this.health -= this.decay * dt) <= 0) {
      this.remove();
      return;
    }
    this.spin *= Math.exp(-this.angularDrag * dt);
    this.rotation += this.spin * dt;
    move(this, dt);
    localMovement(
      this,
      this.world
        ? this.world.movementParents || this.world.entities.values()
        : this.collections[1] || [],
      dt,
    );
  }
}
