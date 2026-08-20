import { flare } from '../flare';

// The middle nozzle is twice the size of the pair sat either side of it
const size = 6;
const offset = 18;

export const thrusterTripleMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'Triple Medium Thrusters',
  offset,
  parts: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, size * 2), thrusterNozzleSide: 0 },
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 1 },
  ],
  price: 1800,
  switched: true,
  thrust: 108,
  zIndex: -1,
};
