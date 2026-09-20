/**
 * Based on Kontra vector.js, available under the MIT licence:
 * https://github.com/straker/kontra/blob/main/src/vector.js
 *
 * Keeps the vector factory and the set, add, subtract, scale, normalize, dot,
 * length and distance operations used by the game. Clamp and its coordinate
 * accessors, angle, and direction are removed.
 */

class VectorClass {
  constructor(public x = 0, public y = 0) {}

  set(vector: Vector) {
    Object.assign(this, vector);
  }

  add(vector: Vector) {
    return Vector(this.x + vector.x, this.y + vector.y);
  }

  subtract(vector: Vector) {
    return Vector(this.x - vector.x, this.y - vector.y);
  }

  scale(value: number) {
    return Vector(this.x * value, this.y * value);
  }

  normalize(length = this.length() || 1) {
    return Vector(this.x / length, this.y / length);
  }

  dot(vector: Vector) {
    return this.x * vector.x + this.y * vector.y;
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  distanceTo(vector: Vector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
}

export const Vector = (x = 0, y = 0) => new VectorClass(x, y);

export type Vector = ReturnType<typeof Vector>;
