/**
 * The corral is a pentagonal ring around a core, turned so that one of its
 * five sides runs straight down the right of it. Every side has the same
 * socket cut into it. The right hand one holds a docking bay, and the other
 * four are filled by a plain panel of exactly the socket's shape, so the five
 * sides read the same way round.
 *
 * The socket is cut from the bay's own measurements, so the two cannot drift
 * apart and leave a hull edge showing through the bay.
 */
import { bayCorner, bayDepth, baySpan, dockingBay } from '../modules';

// The flat right hand side runs between these two corners, and the ring runs
// this far in before it meets the core
const face = 250;
const corner = 182;
const inner = 138;
const innerCorner = 100;

// How much of a bay is sunk into the hull, the rest of it standing proud
const sunk = 0.65;

const mount = face - bayDepth * sunk;

// The socket is cut wider and deeper than the bay it holds by exactly one
// stroke width, so the hull outline sits right alongside the bay's with
// nothing showing between the two
const gap = 3;

// Cut corners have to be pushed out along their own diagonal rather than
// squared off, or they open up wider than the sides do
const bevel = gap * (Math.SQRT2 - 1);

const back = mount - gap;
const front = mount + bayDepth + gap;
const edge = baySpan / 2 + gap;
const cut = baySpan / 2 - bayCorner + bevel;
const notch = mount + bayCorner - bevel;
const chamfer = notch - back;

const turn = (points, angle) => points.map(([x, y]) => [
  x * Math.cos(angle) - y * Math.sin(angle),
  x * Math.sin(angle) + y * Math.cos(angle),
]);

// One side of the ring: a wedge at either end of the socket, and the panel
// that closes the back of it
const side = [
  [[face, -corner], [face, -edge], [notch, -edge], [back, -cut], [inner, -innerCorner]],
  [[face, corner], [inner, innerCorner], [back, cut], [notch, edge], [face, edge]],
  [[inner, -innerCorner], [back, -cut], [back, cut], [inner, innerCorner]],
];

const angles = Array.from({ length: 5 }, (_, i) => i * Math.PI * 2 / 5);

// The core is the ring of inner corners that every side shares
const core = angles.map((angle) => turn([[inner, -innerCorner]], angle)[0]);

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

export const corral = {
  name: 'Corral',
  price: 60000,
  // Radians a second. A station is never still, it just turns very slowly
  turnRate: 0.05,
  hullSegments: [
    ...angles.flatMap((angle, i) => side.map((points, piece) => ({
      health: 100,
      // Only the socket with the bay in it can be flown through. The other
      // four are the same shape repeated, and are as solid as the rest
      open: i === 0 && piece === 2,
      points: turn(points, angle),
    }))),
    { health: 300, open: true, points: core },
    // Last, so that they are drawn over the socket edges they fill
    ...angles.slice(1).map((angle) => ({ health: 150, points: turn(panel, angle) })),
  ],
  mounts: [
    { fits: [dockingBay], module: dockingBay, x: mount, y: 0 },
  ],
};
