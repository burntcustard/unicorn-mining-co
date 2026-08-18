import { colors } from '../colors';

// Explosive
// Unstable rock that only stays quiet while it is buried. Cutting it out of an
// asteroid starts its fuse, and there is nothing to be done about that except
// get away from it. Drawn as a red slab with a dark seam down it, glowing
// harder and faster the closer it gets to going off
export const explosive = {
  bounciness: 0.1,
  // Seconds from being cut loose to going off
  fuse: 3,
  glow: true,
  health: 15,
  lineColor: colors.black[2],
  lines: [[[-6, 0], [6, 0]]],
  mass: 6,
  name: 'Explosive',
  points: [[-9, -5], [9, -5], [9, 5], [-9, 5]],
  price: 40,
  shades: colors.red,
};
