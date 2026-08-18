/**
 * Each color is a set of three shades, darkest first. How much darker a shade
 * needs to be varies by hue, so these are picked by eye rather than computed.
 *
 * The darkest is used for damaged segments, the middle for fills, and the
 * lightest for lines.
 */
export const colors = {
  red:    ['#c00', '#e22', '#f33'],
  orange: ['#c61', '#e82', '#fa3'],
  yellow: ['#ca1', '#ec3', '#fe4'],
  green:  ['#1b4', '#2d6', '#3f7'],
  blue:   ['#14b', '#36d', '#47f'],
  violet: ['#b2c', '#c4e', '#d6f'],
  white:  ['#ddd', '#eee', '#fff'],
  black:  ['#000', '#111', '#222'],
};
