import { flare } from '../flare';

export const thrusterTriple = {
  health: 25,
  name: 'THRUSTERS *3',
  offset: 14,
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, 2), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, 5), thrusterNozzleSide: 0 },
    { points: (segment) => flare(segment, 2), thrusterNozzleSide: 1 },
  ],
  price: 1800,
  powerUsage: 30,
  forwardThrust: 28,
  rotationalThrust: 24,
  zIndex: -1,
};
