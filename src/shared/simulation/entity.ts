import { Vector, type Vector as VectorValue } from '../../vector';
import { move } from './movement';

type EntityProperties = {
  id: number;
  mass?: number;
  position?: VectorValue;
  radius?: number;
  rotation?: number;
  spin?: number;
  velocity?: VectorValue;
};

/** Headless movement shared by every simulation entity and browser sprite. */
export class SimulationEntity {
  id: number;
  mass: number;
  position: VectorValue;
  radius: number;
  rotation: number;
  spin: number;
  velocity: VectorValue;

  constructor({
    id,
    mass = 0,
    position = Vector(),
    radius = 0,
    rotation = 0,
    spin = 0,
    velocity = Vector(),
  }: EntityProperties) {
    this.id = id;
    this.mass = mass;
    this.position = position;
    this.radius = radius;
    this.rotation = rotation;
    this.spin = spin;
    this.velocity = velocity;
  }

  update(dt: number) {
    this.rotation += this.spin * dt;
    move(this, dt);
  }
}
