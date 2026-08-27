import { colors } from '../colors';

// Explosive
// Unstable asteroid that only stays quiet while buried. Cutting it out of an
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
  name: 'EXPLOSIVE',
  points: [[-9, -5], [9, -5], [9, 5], [-9, 5]],
  price: 40,
  shades: colors.red,
};
