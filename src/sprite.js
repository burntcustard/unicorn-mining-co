import { Vector } from './vector';
import { getContext } from './core';

/**
 * Shared position and movement state for physical game objects. Supplied
 * properties are copied on after the defaults, including through the vector
 * coordinate setters.
 */
export class Sprite {
  constructor(properties = {}) {
    const { x, y, dx, dy } = properties;

    this.position = Vector(x, y);
    this.velocity = Vector(dx, dy);
    this.rotation = 0;
    this.spin = 0;
    this.ctx = getContext();
    Object.assign(this, properties);
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
}
