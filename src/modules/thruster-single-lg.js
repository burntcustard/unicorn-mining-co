import { flare } from '../flare';

// Half height of the flare
const size = 9;

export const thrusterSingleLg = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 40,
  name: 'Single Large Thruster',
  disablePhysics: true,
  model: [
    { points: (segment) => flare(segment, size), thrusterNozzleSide: 0 },
  ],
  price: 1000,
  thrust: 40,
  zIndex: -1,
};
