// Cargo scoop
// A pair of doors hinged at their outer ends, lying flat inside the hull and
// swinging forwards to open a mouth in the side of the ship: | closed, < open.
// It sits far enough in that only the door on the outside of the ship swings
// clear of the hull, so the scoop reads the same on either side of it
const scoopLength = 16;

// Well past square to the hull, in radians, so a door stands right out of it
const openAngle = 2.5;

// Half the thickness of a door. It is drawn as the slab it is hit on, with no
// outline round it, so the three it comes to is the three a line would have
// been. Thinner than this and cargo travelling a whole frame's worth in one go
// steps clean over it
const doorWidth = 1.5;

// How far back the throat reaches from the mount the scoop hangs on. Cargo is
// taken in once its middle is inside this, not when a corner of it brushes the
// edge. The mount sits a scoop length in from the hull, so what is left over
// is how far into the ship an asteroid is seen to travel before it goes: all of the
// way to the mount and it would wink out on the hull line instead
const throatRadius = scoopLength * 0.75;

// Far enough out that the doors are no longer a wall across the way in
export const scoopOpen = 0.5;

// A door, hinged at its outer end and swinging forward as the scoop opens. A
// long thin rectangle, which is the whole of why it can be collided with
const doorPoints = (activationProgress, side) => {
  const angle = activationProgress * openAngle;
  const fromY = side * scoopLength;
  const toX = scoopLength * Math.sin(angle);
  const toY = side * scoopLength * (1 - Math.cos(angle));
  const runY = toY - fromY;
  const length = Math.hypot(toX, runY);
  const outX = (runY / length) * doorWidth;
  const outY = (-toX / length) * doorWidth;

  return [
    [outX, fromY + outY],
    [toX + outX, toY + outY],
    [toX - outX, toY - outY],
    [-outX, fromY - outY],
  ];
};

const door = (side) => ({
  outline: [],
  points: ({ activationProgress }) => doorPoints(activationProgress, side),
  radius: () => scoopLength * 2,
});

export const cargoScoop = {
  // Slow enough to read as a door swinging rather than a flicker
  activationDuration: 0.7,
  key: 'cC',
  name: 'SCOOP',
  health: 20,
  model: [
    door(-1),
    door(1),
    {
      // Nothing to see and nothing to bump into: a throat notices cargo
      // between the doors. Closed doors are still a hull-blocked route.
      catches: true,
      radius: () => throatRadius,
    },
  ],
  price: 150,
  powerUsage: 4,
  // An open mouth is what draws loose cargo in, so this is the piece that
  // decides whether a ship can pick anything up
  scoops: true,
  zIndex: -1,
};
