import { flare } from '../flare';

// Half height of the flare
const size = 6;

export const thrusterSingleMd = {
  // Quick enough that the flare is up about as soon as the key is down
  activationDuration: 0.1,
  health: 25,
  name: 'Single Medium Thruster',
  parts: [
    { points: (segment) => flare(segment, size), side: 0 },
  ],
  price: 450,
  switched: true,
  thrust: 18,
  zIndex: -1,
};
