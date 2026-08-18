import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 4;
const offset = 9;

export const thrusterDualSm = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 15,
  name: 'Dual Small Thrusters',
  parts: [
    { points: (segment) => flare(segment, -offset, size), side: -1 },
    { points: (segment) => flare(segment, offset, size), side: 1 },
  ],
  price: 350,
  switched: true,
  thrust: 16,
  zIndex: -1,
};
