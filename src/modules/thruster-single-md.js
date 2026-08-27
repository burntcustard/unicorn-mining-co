import { flare } from '../flare';

// Half height of the flare
const size = 6;

export const thrusterSingleMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'SINGLE MEDIUM THRUSTER',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 0 },
  ],
  price: 450,
  thrust: 18,
  zIndex: -1,
};
