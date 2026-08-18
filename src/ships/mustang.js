/**
 * The mustang is a hexagonal hull split into eight triangular segments, with a
 * cockpit at the nose and five mounting points for modules to be fitted to.
 */
import { cargoScoop, cockpit, floodlight, horn, shield, thrusterDualSm, thrusters } from '../modules';

export const mustang = {
  cargo: 12,
  drag: 5,
  mass: 9,
  name: 'Mustang',
  price: 2000,
  turnRate: 4,
  // The cockpit takes its health from the hull it is built into rather than
  // bringing its own, because it is a different shape on every ship
  hullSegments: [
    { health: 10, points: [[-16, -36], [-4, -36], [-16, -20]] },
    { health: 20, points: [[-4, -36], [20, -12], [-16, -20]] },
    { health: 20, points: [[-16, -20], [20, -12], [8, 0]] },
    { health: 25, points: [[-16, -20], [8, 0], [-16, 20]] },
    { health: 30, module: cockpit, points: [[20, -12], [20, 12], [8, 0]] },
    { health: 20, points: [[8, 0], [20, 12], [-16, 20]] },
    { health: 20, points: [[-16, 20], [20, 12], [-4, 36]] },
    { health: 10, points: [[-16, 20], [-4, 36], [-16, 36]] },
  ],
  // Mounts only say where a module goes and which ones will go there. Which
  // way it faces is the module's own business
  mounts: [
    { fits: thrusters, module: thrusterDualSm, x: -16, y: 0 },
    { fits: [shield], x: 0, y: 0 },
    { fits: [cargoScoop], module: cargoScoop, x: 3, y: -13 },
    { fits: [cargoScoop], module: cargoScoop, x: 3, y: 13 },
    { fits: [horn], module: horn, x: 20, y: 0 },
    // Under the nose, in behind the horn on the same spot
    { fits: [floodlight], x: 20, y: 0 },
  ],
};
