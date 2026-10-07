import { game } from '../game';
import {
  defaultMass,
  defaultFriction,
  defaultAngularInertiaScale,
} from '../../specs/game-object';
import { motion } from '../../specs/local-movement';
import * as Vec from '../utilities/vector';
import { createRandom, type Random } from '../utilities/seeded-random';
import { localMovement } from '../simulation/local-movement';
import { roundMotion } from '../utilities/round';
import { type Collider } from '../collision/types';
import { type SimulationWorld } from '../simulation/world';

import { type Pose } from '../types';

export interface RenderOptions {
  draw?: () => void;
  pose?: Pose;
}

let nextId = -1;

export class GameObject {
  [key: string]: any;
  angularDrag = 0;
  angularInertiaScale = defaultAngularInertiaScale;
  buried: boolean | undefined = undefined;
  collections: any[][] = [];
  dead = false;
  decay?: number = undefined;
  drag: number | undefined = undefined;
  static friction = defaultFriction;
  friction = (this.constructor as typeof GameObject).friction;
  health: number | undefined = undefined;
  id: number;
  kind?: string = undefined;
  label?: string = undefined;
  // Initialize hot optional fields before subclasses add their own properties.
  localMovementParent: GameObject | 0 | undefined = undefined;
  localMovementRate: number | undefined = undefined;
  // Loose modules use the base object mass; items are lighter.
  mass = defaultMass;
  message?: string = undefined;
  paint?: number = undefined;
  pendingUpdateTime = 0;
  physics = true;
  playerId?: number = undefined;
  pointCount?: number = undefined;
  position: Vec.Value;
  radius = 0;
  radiusEven?: number = undefined;
  random: Random;
  resource?: number = undefined;
  rotation = 0;
  rotationJump = 0;
  spin = 0;
  velocity: Vec.Value;
  world?: SimulationWorld;

  add() {
    this.dead = false;
    this.world?.entities.set(this.id, this as any);

    this.collections.forEach((list) => {
      if (!list.includes(this)) list.push(this);
    });
  }

  addToScene() {
    this.collections = [game.sprites];
    this.add();
    return this;
  }

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
    const specs: Function[] = [];

    // Inherited class defaults are available before a craft builds its hull.
    // Per-instance properties, including restored state, always take priority.
    for (
      let type: any = this.constructor;
      type && type !== GameObject;
      type = Object.getPrototypeOf(type)
    ) {
      specs.unshift(type);
    }

    Object.assign(this, ...specs, properties);
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

  render({ draw, pose = this }: RenderOptions = {}) {
    const { ctx } = game;

    ctx.save();
    ctx.translate(pose.position.x, pose.position.y);
    ctx.rotate(pose.rotation);
    draw?.();
    ctx.restore();
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

  /**
   * Face a direction instantly, excluding the turn from angular motion.
   */
  face(rotation: number) {
    this.rotationJump += rotation - this.rotation;
    this.rotation = rotation;
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
      let kept = Math.exp(-drag * dt);

      // The speed limit must not bypass drag when rounded motion sits above it.
      if (speed > maxSpeed) {
        kept = Math.min(
          kept,
          Math.max(maxSpeed, speed * motion.maxSpeedDrag ** (dt * 60)) / speed,
        );
      }

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
