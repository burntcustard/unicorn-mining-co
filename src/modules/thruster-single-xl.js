import { flare } from '../flare';

export const thrusterSingleXl = {
  health: 15,
  name: 'THRUSTERS *1+',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, 6), thrusterNozzleSide: 0 },
  ],
  price: 200,
  forwardThrust: 26,
  rotationalThrust: 14,
  zIndex: -1,
};
