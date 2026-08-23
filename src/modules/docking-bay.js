// Docking bay
// Where a ship flies in to dock with a station. It is a letterbox running
// along the station's edge with its corners cut off, in two halves: the half
// nearer the station is drawn over the top of ships, so a ship that flies all
// the way in disappears inside it, and the half out in the open is drawn
// behind them, so a ship arriving sits on the bay floor. Neither half is drawn
// along the seam where the two meet, so the join never shows.
// Just enough off each corner to knock the squareness out of it
export const bayCorner = 6;

export const bayDepth = 41;
export const baySpan = 188;

const seam = bayDepth / 2;
const edge = baySpan / 2;

// Both halves as one outline, so the light pools along the whole bay rather
// than in either end of it. It goes down on both layers, so a ship sat in the
// bay has it under and over at once and reads as being inside the light
const glow = [
  [0, bayCorner - edge],
  [bayCorner, -edge],
  [bayDepth - bayCorner, -edge],
  [bayDepth, bayCorner - edge],
  [bayDepth, edge - bayCorner],
  [bayDepth - bayCorner, edge],
  [bayCorner, edge],
  [0, edge - bayCorner],
];

const underneath = [
  [seam, -edge],
  [bayDepth - bayCorner, -edge],
  [bayDepth, bayCorner - edge],
  [bayDepth, edge - bayCorner],
  [bayDepth - bayCorner, edge],
  [seam, edge],
];

const ontop = [
  [seam, edge],
  [bayCorner, edge],
  [0, edge - bayCorner],
  [0, bayCorner - edge],
  [bayCorner, -edge],
  [seam, -edge],
];

export const dockingBay = {
  disablePhysics: true,
  name: 'Docking Bay',
  // Both halves share one glow, but their outlines stop at the seam.
  model: [
    {
      fillAlpha: 4,
      points: underneath,
      unclosed: true,
      glow,
      zIndex: -3,
    },
    {
      fillAlpha: 4,
      points: ontop,
      unclosed: true,
      glow,
      zIndex: 3,
    },
  ],
};
