import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';

export const applyForce = (object: GameObject, force: Vec.Value, spin = 0) => {
  const inverseMass = 1 / object.mass;

  Vec.addScaled(object.velocity, force, inverseMass, object.velocity);
  object.spin += spin / object.mass;
};
