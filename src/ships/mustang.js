/**
 * The mustang is a hexagonal hull split into eight triangular segments, with
 * six mounting points for modules to be fitted to.
 */
import {
  cargoScoop,
  floodlight,
  horn,
  shield,
  thrusterDualMd,
  thrusterDualSm,
  thrusterTripleSm,
} from '../modules';

export const mustang = {
  cargoSpace: 12,
  drag: 5,
  mass: 9,
  name: 'Mustang',
  price: 2000,
  turnRate: 3,
  hullSegments: [
    { health: 10, points: [[-16, -36], [-4, -36], [-16, -20]] },
    // The wedges the scoops open onto. They stand aside for cargo while the
    // doors are open, which is what lets an item fall in under the hull and
    // into the throat waiting behind them
    {
      health: 20,
      mounts: [{ fits: [cargoScoop], x: 3, y: -13 }],
      points: [[-4, -36], [20, -12], [-16, -20]],
    },
    { health: 20, points: [[-16, -20], [20, -12], [8, 0]] },
    {
      health: 25,
      mounts: [
        { fits: [thrusterDualSm, thrusterTripleSm, thrusterDualMd], x: -16, y: 0 },
        { fits: [shield], x: 0, y: 0 },
      ],
      points: [[-16, -20], [8, 0], [-16, 20]],
    },
    {
      health: 30,
      mounts: [
        { fits: [horn], x: 20, y: 0 },
        { fits: [floodlight], x: 20, y: 0 },
      ],
      points: [[20, -12], [20, 12], [8, 0]],
    },
    { health: 20, points: [[8, 0], [20, 12], [-16, 20]] },
    {
      health: 20,
      mounts: [{ fits: [cargoScoop], x: 3, y: 13 }],
      points: [[-16, 20], [20, 12], [-4, 36]],
    },
    { health: 10, points: [[-16, 20], [-4, 36], [-16, 36]] },
  ],
};
