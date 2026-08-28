// Floodlight
// A lamp slung under the nose that throws a cone of light out ahead of the
// ship. It sits below the hull so that what it falls on is whatever the ship
// is flying over, with the hull itself sat dark on top of it.

// Where the lens sits ahead of its mount, and how far the cone carries
const lens = 2;
const reach = 400;
const far = lens + reach;

// Half width of the cone at the lens and at the far end of its reach, the
// second of which works out at five degrees off the middle either way
const mouth = 5;
const spread = 35;

// Just enough off the two far corners to knock the squareness out of them.
// Worth keeping in proportion to the spread, because it is taken off both the
// length and the width and a cone narrower than about three of these ends up
// tapering to a point rather than being eased at the corners
const corner = 10;

/**
 * A lamp throws its full length the moment it is switched on, so the cone is
 * the same shape whenever it shows at all and only its brightness comes up.
 *
 * @param {Object} segment - `anim` runs 0 to 1 as the lamp comes up.
 */
const cone = ({ anim }) => (anim ?
    [
      [lens, -mouth],
      [far - corner, -spread],
      [far, corner - spread],
      [far, spread - corner],
      [far - corner, spread],
      [lens, mouth],
    ] :
    []);

export const floodlight = {
  activationDuration: 0.15,
  // Lit rather than painted, so it lifts everything already drawn under it
  beam: true,
  disablePhysics: true,
  key: 'l',
  lens,
  mouth,
  name: 'LIGHT',
  model: [{ points: cone }],
  price: 450,
  reach,
  spread,
  zIndex: -1,
};
