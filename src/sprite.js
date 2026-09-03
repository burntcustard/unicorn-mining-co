import { Vector, move } from './vector';
import { forget, game } from './game';
import { getContext } from './core';
import { localMovement } from './local-movement';

/**
 * Shared position and movement state for physical game objects. Supplied
 * properties are copied on after the defaults, including through the vector
 * coordinate setters.
 */
export class Sprite {
  constructor(properties) {
    const { x, y, dx, dy } = properties;

    this.position = Vector(x, y);
    this.velocity = Vector(dx, dy);
    this.rotation = 0;
    this.spin = 0;
    this.ctx = getContext();
    Object.assign(this, properties);
    this.add();
  }

  get x() {
    return this.position.x;
  }

  get y() {
    return this.position.y;
  }

  set x(value) {
    this.position.x = value;
  }

  set y(value) {
    this.position.y = value;
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

  update(dt) {
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
