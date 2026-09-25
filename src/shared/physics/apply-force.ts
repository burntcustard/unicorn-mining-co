import * as Vec from '../vector';
import { type GameObject } from '../game-object';

export const applyForce = (object: GameObject, force: Vec.Value, spin = 0) => {
  const inverseMass = 1 / object.mass;

  Vec.addScaled(object.velocity, force, inverseMass, object.velocity);
  object.spin += spin / object.mass;
};
