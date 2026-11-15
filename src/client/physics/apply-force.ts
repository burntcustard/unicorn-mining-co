import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { flight } from '../../specs/control-ship';

export const physicsMass = (object: GameObject) =>
  object.kind === 'ship'
    ? object.mass / flight.massPerPhysicsUnit
    : object.mass;

export const applyForce = (object: GameObject, force: Vec.Value, spin = 0) => {
  const inverseMass = 1 / physicsMass(object);

  Vec.addScaled(object.velocity, force, inverseMass, object.velocity);
  object.spin += spin / physicsMass(object);
};
