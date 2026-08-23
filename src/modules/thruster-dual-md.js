import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 6;
const offset = 9;

export const thrusterDualMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'Dual Medium Thrusters',
  offset,
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 1 },
  ],
  price: 800,
  thrust: 36,
  zIndex: -1,
};
