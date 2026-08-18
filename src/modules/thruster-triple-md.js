import { flare } from '../flare';

// The middle nozzle is twice the size of the pair sat either side of it
const size = 6;
const offset = 18;

export const thrusterTripleMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'Triple Medium Thrusters',
  parts: [
    { points: (segment) => flare(segment, -offset, size), side: -1 },
    { points: (segment) => flare(segment, 0, size * 2), side: 0 },
    { points: (segment) => flare(segment, offset, size), side: 1 },
  ],
  price: 1800,
  switched: true,
  thrust: 108,
  zIndex: -1,
};
