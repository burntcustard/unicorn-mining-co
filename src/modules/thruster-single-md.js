import { flare } from '../flare';

// Half height of the flare
const size = 6;

export const thrusterSingleMd = {
  health: 25,
  name: 'THRUSTERS *1+',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 0 },
  ],
  price: 450,
  powerUsage: 20,
  forwardThrust: 18,
  rotationalThrust: 18,
  zIndex: -1,
};
