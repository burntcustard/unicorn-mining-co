// Cargo scoop
// A pair of doors hinged at their outer ends, lying flat inside the hull and
// swinging forwards to open a mouth in the side of the ship: | closed, < open.
// It sits far enough in that only the door on the outside of the ship swings
// clear of the hull, so the scoop reads the same on either side of it
const scoopLength = 16;

// Well past square to the hull, in radians, so a door stands right out of it
const openAngle = 2.5;

export const cargoScoop = {
  // Slow enough to read as a door swinging rather than a flicker
  activationDuration: 0.7,
  health: 20,
  lines: ({ anim }) => {
    const angle = anim * openAngle;
    const x = scoopLength * Math.sin(angle);
    const y = scoopLength * Math.cos(angle);

    return [
      [[0, -scoopLength], [x, y - scoopLength]],
      [[0, scoopLength], [x, scoopLength - y]],
    ];
  },
  name: 'Cargo Scoop',
  price: 150,
  switched: true,
  zIndex: -1,
};
