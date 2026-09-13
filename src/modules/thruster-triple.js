import { flare } from '../flare';

export const thrusterTriple = {
  health: 30,
  name: 'THRUSTERS *3',
  offset: 14,
  disablePhysics: true,
  model: [
    { points: flare(3), thrusterNozzleSide: -1 },
    { points: flare(5), thrusterNozzleSide: 0 },
    { points: flare(3), thrusterNozzleSide: 1 },
  ],
  price: 1800,
  forwardThrust: 28,
  rotationalThrust: 24,
  zIndex: -1,
};
