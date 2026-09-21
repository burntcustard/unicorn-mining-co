/**
 * Each palette contains damage, module fill, hull/line, shadow and highlight
 * colours. Shades are picked by eye to suit each hue.
 */
export const colors = {
  red: ['#c00', '#d10', '#f32', '#400', '#f20'],
  orange: ['#c61', '#e82', '#fa3', '#930', '#f80'],
  yellow: ['#ca1', '#ec3', '#fe4', '#c50', '#f95'],
  green: ['#1b4', '#2d6', '#3f7', '#06d', '#efa'],
  cyan: ['#0ac', '#1bd', '#4df', '#148', '#cff'],
  indigo: ['#33c', '#44d', '#55f', '#217', '#bdf'],
  violet: ['#c2c', '#d3d', '#e6f', '#427', '#e6f'],
  purple: ['#102', '#213', '#325', '#001', '#647'],
  white: ['#ddd', '#eee', '#fff', '#33c', '#f8d'],
  grey: ['#778', '#99a', '#bbc', '#334', '#eef'],
  black: ['#000', '#111', '#222', '#879', '#200'],
} as const;
