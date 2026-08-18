import { colors } from '../colors';

// Opal
// Round rather than cut, so it brings a radius instead of an outline and is
// collided with as the circle it is. The only item that takes the light apart
// across its whole face rather than wearing one colour, because that play of
// colour is the whole of what an opal is. Its shades are white, so the
// rainbow has something pale to sit on
export const opal = {
  bounciness: 0.12,
  health: 50,
  mass: 5,
  name: 'Opal',
  price: 450,
  radius: 6,
  rainbow: true,
  shades: colors.white,
  shine: true,
};
