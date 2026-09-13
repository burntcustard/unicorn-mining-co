import { flare } from '../flare';

// Half height of each flare, and how far off the middle each nozzle sits
const size = 6;
const offset = 11;

export const thrusterDualXl = {
  health: 25,
  name: 'THRUSTERS *2 XL',
  offset,
  disablePhysics: true,
  model: [
    { points: flare(size), thrusterNozzleSide: -1 },
    { points: flare(size), thrusterNozzleSide: 1 },
  ],
  price: 800,
  forwardThrust: 22,
  rotationalThrust: 24,
  zIndex: -1,
};
