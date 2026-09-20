import { forget, game } from './game';
import { Vector, type Vector as VectorValue } from './vector';
import { getContext } from './core';
import { localMovement } from './local-movement';
import { move } from './move';

/**
 * Shared position and movement state for physical game objects. Position and
 * velocity default to zero Vectors; supplied properties replace the defaults.
 */
export class Sprite {
  [key: string]: any;

  position: VectorValue;
  radius: number;
  rotation: number;
  spin: number;
  velocity: VectorValue;

  constructor(properties: any) {
    const { position = Vector(), velocity = Vector() } = properties;

    this.position = position;
    this.velocity = velocity;
    this.rotation = 0;
    this.spin = 0;
    this.ctx = getContext();
    Object.assign(this, properties);
    this.add();
  }

  hitboxes() {
    return this.dead || this.buried ? [] : [this];
  }

  add() {
    this.dead = false;
    game.sprites.push(this);
  }

  remove() {
    this.dead = true;
    forget(game.sprites, this);
  }

  update(dt: number) {
    if (this.dead || this.buried) return;
    // @ifdef DEBUG
    if (!game.physicsOn) return;
    // @endif

    // Debris wears away rather than being counted down: `decay` is the health
    // it loses a second, and it is gone once that health is
    if (this.decay && (this.health -= this.decay * dt) <= 0) {
      this.remove();
      return;
    }

    this.rotation += this.spin * dt;
    move(this, dt);
    localMovement(this, game.crafts, dt);
  }
}
