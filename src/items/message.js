import { colors } from '../colors';

// Message
// A data slate somebody left behind, drawn as a tablet with two lines of
// writing on it. Worth almost nothing to sell, and worth having for what it
// says: where the good asteroid is, or who is selling cheap this week.
//
// Only the letters, digits and punctuation the font actually has, because
// anything else comes out as a gap
const notes = [
  'ORE FIELD 400/200 - RICH SEAM',
  'CORRAL STATION 30% OFF THRUSTERS',
  'WRECK AT 900/-40, CARGO ABOARD',
  'DO NOT MINE RED ASTEROIDS!',
];

export const message = {
  bounciness: 0.2,
  health: 100,
  lines: [[[-4, -1], [4, -1]], [[-4, 2], [2, 2]]],
  name: 'Message',
  // One of the notes, unless whatever spawned it had something to say
  notes,
  points: [[-7, -5], [7, -5], [7, 5], [-7, 5]],
  shades: colors.orange,
};
