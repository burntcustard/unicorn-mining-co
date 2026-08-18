import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 6;
const offset = 9;

export const thrusterDualMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'Dual Medium Thrusters',
  parts: [
    { points: (segment) => flare(segment, -offset, size), side: -1 },
    { points: (segment) => flare(segment, offset, size), side: 1 },
  ],
  price: 800,
  switched: true,
  thrust: 36,
  zIndex: -1,
};
