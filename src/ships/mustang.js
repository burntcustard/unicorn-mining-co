/**
 * The mustang is a hexagonal hull split into eight triangular segments, with
 * a cockpit at the nose and a mining horn bolted onto the front of it.
 */
import { cockpit, horn, thruster } from '../modules';

export const mustang = {
  mass: 9,
  maxSpeed: 4,
  thrust: 9,
  turnRate: 4,
  segments: [
    { module: thruster, points: [[-16, -12], [-24, -8], [-16, -4]] },
    { module: thruster, points: [[-16, 12], [-24, 8], [-16, 4]] },
    { points: [[-16, -36], [-4, -36], [-16, -20]] },
    { points: [[-4, -36], [20, -12], [-16, -20]] },
    { points: [[-16, -20], [20, -12], [8, 0]] },
    { points: [[-16, -20], [8, 0], [-16, 20]] },
    { module: cockpit, points: [[20, -12], [20, 12], [8, 0]] },
    { points: [[8, 0], [20, 12], [-16, 20]] },
    { points: [[-16, 20], [20, 12], [-4, 36]] },
    { points: [[-16, 20], [-4, 36], [-16, 36]] },
    { module: horn },
  ],
};
