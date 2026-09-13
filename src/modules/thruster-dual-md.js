import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 4;
const offset = 10;

export const thrusterDualMd = {
  health: 20,
  name: 'THRUSTERS *2',
  offset,
  disablePhysics: true,
  model: [
    { points: flare(size), thrusterNozzleSide: -1 },
    { points: flare(size), thrusterNozzleSide: 1 },
  ],
  price: 350,
  forwardThrust: 16,
  rotationalThrust: 16,
  zIndex: -1,
};
