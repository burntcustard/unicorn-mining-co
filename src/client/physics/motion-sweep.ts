import { sinCos } from '../utilities/sin-cos';
import * as Vec from '../utilities/vector';
import { TransformValue } from '../utilities/vector-math';

/**
 * This describes body motion for TOI computation. Game-object mass is centered
 * at the body origin, so the swept position is the body's transform position.
 */
export class Sweep {
  // World angle
  a = 0;
  a0 = 0;
  // Fraction of the current time step in the range [0,1], c0 and a0 are c and a at alpha0.
  alpha0 = 0;
  // World center position
  c = Vec.create();
  c0 = Vec.create();
  cosA0 = 1;
  private rotation = { sin: 0, cos: 1 };
  sinA0 = 0;
  private trigAngle = NaN;

  /**
   * Advance the sweep forward, yielding a new initial state.
   *
   * @param alpha The new initial time
   */
  advance(alpha: number): void {
    const beta = (alpha - this.alpha0) / (1 - this.alpha0);

    Vec.combine2Into(this.c0, beta, this.c, 1 - beta, this.c0);
    this.a0 = beta * this.a + (1 - beta) * this.a0;
    this.alpha0 = alpha;
  }

  /**
   * Get the interpolated transform at a specific time.
   *
   * @param xf
   * @param beta A factor in [0,1], where 0 indicates alpha0
   */
  getTransform(xf: TransformValue, beta: number): void {
    sinCos(xf.q, (1 - beta) * this.a0 + beta * this.a);
    Vec.combine2Into(xf.p, 1 - beta, this.c0, beta, this.c);
  }

  /**
   * normalize the angles in radians to be between -pi and pi.
   */
  normalize(): void {
    const wrapped = (this.a0 + Math.PI) % (2 * Math.PI);
    const a0 = wrapped + (wrapped < 0 ? Math.PI : -Math.PI);

    this.a -= this.a0 - a0;
    this.a0 = a0;
  }

  // Refresh cosA0/sinA0 for the rotation at alpha0 when a0 has changed.
  rotation0(): this {
    if (this.trigAngle !== this.a0) {
      this.trigAngle = this.a0;
      sinCos(this.rotation, this.a0);
      this.cosA0 = this.rotation.cos;
      this.sinA0 = this.rotation.sin;
    }

    return this;
  }

  set(that: Sweep): void {
    Vec.set(this.c, that.c);
    this.a = that.a;
    this.alpha0 = that.alpha0;
    Vec.set(this.c0, that.c0);
    this.a0 = that.a0;
  }

  setTransform(xf: TransformValue): void {
    Vec.set(this.c, xf.p);
    Vec.set(this.c0, xf.p);

    this.a = this.a0 = Math.atan2(xf.q.sin, xf.q.cos);
  }
}
