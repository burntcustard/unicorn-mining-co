import { type Vector } from './vector';

export const applyForce = (object: any, force: Vector, spin = 0) => {
  object.velocity.set(object.velocity.add(force.scale(1 / object.mass)));
  object.spin += spin / object.mass;
};
