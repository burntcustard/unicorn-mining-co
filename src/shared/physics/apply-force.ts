import { type GameObject } from '../game-object';
import { type Vector } from '../vector';

export const applyForce = (object: GameObject, force: Vector, spin = 0) => {
  object.velocity.set(object.velocity.add(force.scale(1 / object.mass)));
  object.spin += spin / object.mass;
};
