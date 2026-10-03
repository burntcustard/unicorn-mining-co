import {
  defaultMass,
  defaultFriction,
  defaultAngularInertiaScale,
} from '../../definitions/game-object';
import { motion } from '../../definitions/local-movement';
import * as Vec from '../utilities/vector';
import { createRandom, type Random } from '../utilities/seeded-random';
import { localMovement } from '../simulation/local-movement';
import { roundMotion } from '../utilities/round';
import { type Collider } from '../collision/types';
import { type SimulationWorld } from '../simulation/world';

let nextId = -1;

export class GameObject {
  static friction = defaultFriction;
  [key: string]: any;
  id: number;
  position: Vec.Value;
  velocity: Vec.Value;
  rotation = 0;
  spin = 0;
  angularDrag = 0;
  angularInertiaScale = defaultAngularInertiaScale;
  // Loose modules use the same small default mass as items.
  mass = defaultMass;
  physics = true;
  friction = (this.constructor as typeof GameObject).friction;
  radius = 0;
  dead = false;
  pendingUpdateTime = 0;
  // Initialize hot optional fields before subclasses add their own properties.
  localMovementParent: GameObject | 0 | undefined = undefined;
  localMovementRate: number | undefined = undefined;
  drag: number | undefined = undefined;
  decay?: number = undefined;
  health: number | undefined = undefined;
  buried: boolean | undefined = undefined;
  label?: string = undefined;
  message?: string = undefined;
  paint?: number = undefined;
  playerId?: number = undefined;
  pointCount?: number = undefined;
  radiusEven?: number = undefined;
  resource?: number = undefined;
  kind?: string = undefined;
  world?: SimulationWorld;
  collections: any[][] = [];
  random: Random;
  constructor(
    properties: {
      [key: string]: any;
      id?: number;
      position?: Vec.Value;
      velocity?: Vec.Value;
    } = {},
  ) {
    this.id = properties.id ?? nextId--;
    this.position = properties.position || Vec.create();
    this.velocity = properties.velocity || Vec.create();
    this.random =
      properties.random ||
      properties.world?.random ||
      createRandom(this.id >>> 0);
    const definitions: Function[] = [];

    // Inherited class defaults are available before a craft builds its hull.
    // Per-instance properties, including restored state, always take priority.
    for (
      let type: any = this.constructor;
      type && type !== GameObject;
      type = Object.getPrototypeOf(type)
    ) {
      definitions.unshift(type);
    }
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
  hitbox(): Collider[] {
    // Loose modules and other objects without geometry need no contact fixture.
    return this.dead || this.buried || (!this.radius && !this.shapeOutline)
      ? []
      : [
          {
            owner: this,
            position: this.position,
            radius: this.radius,
            rotation: this.rotation,
            shapeOutline: this.shapeOutline,
            bounciness: this.bounciness,
            friction: this.friction,
            physics: this.physics,
          },
        ];
  }
  /**
   * Keep predicted and authoritative motion on the same numeric grid.
   */
  roundMotion() {
    Vec.setXY(
      this.position,
      roundMotion(this.position.x),
      roundMotion(this.position.y),
    );
    // Keep substep speed-limit branches consistent across the Go and JS runtimes.
    Vec.setXY(
      this.velocity,
      roundMotion(this.velocity.x),
      roundMotion(this.velocity.y),
    );
    this.rotation = roundMotion(this.rotation);
    this.spin = roundMotion(this.spin);
  }
  update(dt: number) {
    if (this.dead || this.buried) return;

    if (this.decay && (this.health -= this.decay * dt) <= 0) {
      this.remove();
      return;
    }

    if (this.angularDrag) this.spin *= Math.exp(-this.angularDrag * dt);
    this.rotation += this.spin * dt;

    const {
      position,
      velocity,
      drag = motion.defaultDrag,
      maxSpeed = motion.defaultMaxSpeed,
    } = this;
    const speedSquared = velocity.x * velocity.x + velocity.y * velocity.y;

    if (speedSquared < motion.minimumSpeedSquared) velocity.x = velocity.y = 0;
    else {
      const speed = Math.sqrt(speedSquared);
      const kept =
        speed > maxSpeed
          ? Math.max(maxSpeed, speed * motion.maxSpeedDrag ** (dt * 60)) / speed
          : Math.exp(-drag * dt);

      Vec.scale(velocity, kept, velocity);
    }
    Vec.addScaled(position, velocity, dt, position);

    localMovement(
      this,
      this.world
        ? this.world.movementParents || this.world.entities.values()
        : this.collections[1] || [],
      dt,
    );
    this.roundMotion();
  }
}
