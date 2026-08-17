/**
 * Each color is a set of three shades, darkest first. How much darker a shade
 * needs to be varies by hue, so these are picked by eye rather than computed.
 *
 * The darkest is used for damaged segments, the middle for fills, and the
 * lightest for lines.
 */
export const colors = {
  red:    ['#a11', '#c22', '#f44'],
  orange: ['#b61', '#d83', '#fa4'],
  yellow: ['#ba1', '#dc3', '#fe4'],
  green:  ['#1a4', '#2c6', '#3f8'],
  blue:   ['#14b', '#36d', '#47f'],
  violet: ['#82c', '#a4e', '#c6f'],
  white:  ['#ddd', '#eee', '#fff'],
};
