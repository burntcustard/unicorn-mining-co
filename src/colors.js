/**
 * Each color is three shades darkest first, then the two the light works with.
 * How much darker a shade needs to be varies by hue, so these are picked by eye
 * rather than computed.
 *
 * The darkest is used for damaged segments, the middle for module fills, the
 * lightest for hull fills and lines. Then comes the shadow a dark side falls
 * towards and the light a lit side lifts to. Both keep to the hue rather than
 * heading for the same blue and pink whatever they start from, because a warm
 * colour shaded towards blue only turns grey.
 */
// Keep the first five palettes in reward-name order (see unlockColor).
export const colors = {
  red:    ['#c00', '#d10', '#f32', '#400', '#f20'],
  orange: ['#c61', '#e82', '#fa3', '#930', '#f80'],
  yellow: ['#ca1', '#ec3', '#fe4', '#c50', '#f95'],
  green:  ['#1b4', '#2d6', '#3f7', '#06d', '#efa'],
  cyan:   ['#0ac', '#1bd', '#4df', '#148', '#cff'],
  // Indigo's unused [2..4] were '#55f', '#217', '#bdf'
  indigo: ['#33c', '#44d', '#fff', '#fff', '#fff'],
  violet: ['#c2c', '#d3d', '#e6f', '#427', '#e6f'],
  // Purple's unused [3..4] were '#001', '#647'
  purple: ['#102', '#213', '#325', '#fff', '#fff'],
  white:  ['#ddd', '#eee', '#fff', '#33c', '#f8d'],
  // Grey removed as it was only used for platinum and it saves a few bytes
  // grey:   ['#778', '#99a', '#bbc', '#334', '#eef'],
  // Black removed to save a few bytes. It was usually used with transparency
  // black:  ['#000', '#111', '#222', '#879', '#200'],
};
