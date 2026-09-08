import { colors } from '../colors';

// Message
// A data slate drawn as a tablet with two lines of writing. Its spawner
// supplies the message, pointing to a resource field or unlocking paint.

export const message = {
  bounciness: 0.2,
  health: 100,
  lines: [[[-4, -1], [4, -1]], [[-4, 2], [2, 2]]],
  // name: 'MESSAGE', // Commented out to save a few bytes
  points: [[-7, -5], [7, -5], [7, 5], [-7, 5]],
  shades: colors.orange,
};
