/**
 * The station is a pentagonal ring around a core, turned so that one of its
 * five sides runs straight down the right of it. Every side has the same
 * socket cut into it. The right hand one holds the docking bay, and the other
 * four are filled by a plain panel of exactly the socket's shape, so the five
 * sides read the same way round.
 *
 * The socket is cut from the bay's own measurements, so the two cannot drift
 * apart and leave a hull edge showing through the bay.
 *
 * There is only the one station, so it is a ship with a different hull rather
 * than anything of its own: it is built, lit, hit and broken up by exactly the
 * same code, and simply never flies.
 */
import { Ship } from './ship';
import { colors } from './colors';
import { rotatePoints } from './vector';

// The flat right hand side runs between these two corners, and the ring runs
// this far in before it meets the core
const face = 250;
const corner = 182;
const inner = 138;
const innerCorner = 100;

// The bay is a letterbox running along the station's edge with its corners cut
// off, in two halves: the half nearer the station is drawn over the top of
// ships, so a ship that flies all the way in disappears inside it, and the
// half out in the open is drawn behind them, so a ship arriving sits on the
// bay floor. Neither half is drawn along the seam where the two meet, so the
// join never shows.
// Just enough off each corner to knock the squareness out of it
const bayCorner = 6;
const bayDepth = 41;
const baySpan = 188;

// How much of a bay is sunk into the hull, the rest of it standing proud
const sunk = 0.65;

// Where the back of the bay sits, which everything about it is measured from
const bay = face - bayDepth * sunk;

const seam = bay + bayDepth / 2;
const nose = bay + bayDepth;
const lip = baySpan / 2;

// The socket is cut wider and deeper than the bay it holds by exactly one
// stroke width, so the hull outline sits right alongside the bay's with
// nothing showing between the two
const gap = 3;

// Cut corners have to be pushed out along their own diagonal rather than
// squared off, or they open up wider than the sides do
const bevel = gap * (Math.SQRT2 - 1);

const back = bay - gap;
const front = nose + gap;
const edge = lip + gap;
const cut = lip - bayCorner + bevel;
const notch = bay + bayCorner - bevel;
const chamfer = notch - back;

// One side of the ring: a wedge at either end of the socket, and the panel
// that closes the back of it
const side = [
  [[face, -corner], [face, -edge], [notch, -edge], [back, -cut], [inner, -innerCorner]],
  [[face, corner], [inner, innerCorner], [back, cut], [notch, edge], [face, edge]],
  [[inner, -innerCorner], [back, -cut], [back, cut], [inner, innerCorner]],
];

const angles = Array.from({ length: 5 }, (_, i) => i * Math.PI * 2 / 5);

// The core is the ring of inner corners that every side shares
const core = angles.map((angle) => rotatePoints([[inner, -innerCorner]], angle)[0]);

// A socket with no bay in it is filled by a panel cut to exactly its shape, so
// that the line around a plain side falls where the line around the bay does
const panel = [
  [back, -cut],
  [notch, -edge],
  [front - chamfer, -edge],
  [front, -cut],
  [front, cut],
  [front - chamfer, edge],
  [notch, edge],
  [back, cut],
];

// Both halves as one outline, so the light pools along the whole bay rather
// than in either end of it. It goes down on both layers, so a ship sat in the
// bay has it under and over at once and reads as being inside the light
const glow = [
  [bay, bayCorner - lip],
  [bay + bayCorner, -lip],
  [nose - bayCorner, -lip],
  [nose, bayCorner - lip],
  [nose, lip - bayCorner],
  [nose - bayCorner, lip],
  [bay + bayCorner, lip],
  [bay, lip - bayCorner],
];

// Both halves share the one glow, but their outlines stop at the seam
const halfBay = (points, zIndex) => ({
  disablePhysics: true,
  fillAlpha: 4,
  glow,
  points,
  shades: colors.green,
  unclosed: true,
  zIndex,
});

const corral = {
  localMovementRadius: 600,
  zIndex: 2,
  hullSegments: [
    ...angles.flatMap((angle, i) => side.map((points, piece) => ({
      // Only the socket with the bay in it can be flown through. The other
      // four are the same shape repeated, and are as solid as the rest
      disablePhysics: i === 0 && piece === 2,
      points: rotatePoints(points, angle),
    }))),
    { disablePhysics: true, dockSegment: true, points: core },
    // After the sides, so that they are drawn over the socket edges they fill
    ...angles.slice(1).map((angle) => ({ points: rotatePoints(panel, angle) })),
    // The half out in the open, drawn behind ships, so one arriving sits on
    // the bay floor
    halfBay([
      [seam, -lip],
      [nose - bayCorner, -lip],
      [nose, bayCorner - lip],
      [nose, lip - bayCorner],
      [nose - bayCorner, lip],
      [seam, lip],
    ], -3),
    // The half nearer the station, drawn over the top of ships, so one that
    // flies all the way in disappears inside it
    halfBay([
      [seam, lip],
      [bay + bayCorner, lip],
      [bay, lip - bayCorner],
      [bay, bayCorner - lip],
      [bay + bayCorner, -lip],
      [seam, -lip],
    ], 3),
  ],
};

export class Station extends Ship {
  constructor(props) {
    super(props, corral);
  }

  // Only a station carries anything: whatever docks with it or drifts inside
  // its reach turns with it
  holds(child) {
    return child.position.distanceTo(this.position) <= this.localMovementRadius;
  }
}
