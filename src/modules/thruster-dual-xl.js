import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 5;
const offset = 11;

export const thrusterDualXl = {
  health: 25,
  name: 'THRUSTERS *2+',
  offset,
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 1 },
  ],
  price: 800,
  powerUsage: 25,
  forwardThrust: 20,
  rotationalThrust: 24,
  zIndex: -1,
};
