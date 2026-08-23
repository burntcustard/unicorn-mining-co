import { flare } from '../flare';

// The middle nozzle is twice the size of the pair sat either side of it
const size = 4;
const offset = 12;

export const thrusterTripleSm = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 15,
  name: 'Triple Small Thrusters',
  offset,
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: -1 },
    { points: (segment) => flare(segment, size * 2), thrusterNozzleSide: 0 },
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 1 },
  ],
  price: 800,
  thrust: 48,
  zIndex: -1,
};
