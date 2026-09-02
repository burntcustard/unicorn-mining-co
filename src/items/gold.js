import { colors } from '../colors';

// Gold
// The same ingot as the platinum, cut shorter and squarer, with a line along
// the top face so the two are told apart at a glance as well as by colour
export const gold = {
  bounciness: 0.1,
  health: 60,
  lines: [[[-5, -1], [5, -1]]],
  name: 'GOLD',
  points: [[-7, -4], [7, -4], [5, 3], [-5, 3]],
  price: 300,
  shades: colors.yellow,
  glint: true,
};
