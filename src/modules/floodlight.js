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

export const floodlight = {
  activationDuration: 0.1,
  // Lit rather than painted, so it lifts everything already drawn under it
  beam: true,
  disablePhysics: true,
  health: 10,
  key: 'lL',
  lens,
  mouth,
  name: 'LIGHT',
  // A lamp throws its full length as it comes up, only changing brightness.
  model: [
    { points: ({ activationProgress }) => (
      activationProgress ?
          [
            [lens, -mouth],
            [far - corner, -spread],
            [far, corner - spread],
            [far, spread - corner],
            [far - corner, spread],
            [lens, mouth],
          ] :
          []
    ),
    },
  ],
  price: 450,
  powerUsage: 5,
  reach,
  spread,
  zIndex: -1,
};
