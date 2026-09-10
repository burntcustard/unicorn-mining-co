import { flare } from '../flare';

export const thrusterSingle = {
  health: 15,
  name: 'THRUSTERS *1 XL',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, 6), thrusterNozzleSide: 0 },
  ],
  price: 200,
  forwardThrust: 22,
  rotationalThrust: 14,
  zIndex: -1,
};
