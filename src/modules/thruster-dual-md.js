import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 4;
const offset = 10;

export const thrusterDualMd = {
  health: 15,
  disablePhysics: true,
  name: 'THRUSTERS *2',
  offset,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 1 },
  ],
  price: 350,
  powerUsage: 15,
  forwardThrust: 16,
  rotationalThrust: 16,
  zIndex: -1,
};
