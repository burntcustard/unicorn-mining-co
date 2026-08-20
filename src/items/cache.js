import { colors } from '../colors';

// Cache
// A strongbox of credits, which is worth nothing to a buyer because it is
// already money: scooping one up pays out on the spot rather than filling a
// hold with something to sell on later. Drawn as a crate with its lid banded
export const cache = {
  bounciness: 0.2,
  // Paid straight into the pilot's account the moment it is picked up
  credits: 200,
  health: 30,
  lines: [[[-8, -3], [8, -3]], [[0, -8], [0, -3]]],
  name: 'Cache',
  points: [[-8, -8], [8, -8], [8, 8], [-8, 8]],
  // Nothing to sell, so nothing a trader will pay for it
  // price: 0,
  shades: colors.green,
};
