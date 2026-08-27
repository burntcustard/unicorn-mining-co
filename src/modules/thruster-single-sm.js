import { flare } from '../flare';

// Half height of the flare
const size = 4;

export const thrusterSingleSm = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 15,
  name: 'SINGLE SMALL THRUSTER',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 0 },
  ],
  price: 200,
  thrust: 8,
  zIndex: -1,
};
