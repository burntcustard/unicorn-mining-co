import { flare } from '../flare';

// The middle nozzle is twice the size of the pair sat either side of it
const size = 4;
const offset = 12;

export const thrusterTripleSm = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 15,
  name: 'Triple Small Thrusters',
  parts: [
    { points: (segment) => flare(segment, -offset, size), side: -1 },
    { points: (segment) => flare(segment, 0, size * 2), side: 0 },
    { points: (segment) => flare(segment, offset, size), side: 1 },
  ],
  price: 800,
  switched: true,
  thrust: 48,
  zIndex: -1,
};
