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

export const dockingBay = {
  health: 100,
  name: 'Docking Bay',
  // A bay is there to be flown into, so nothing bumps off it
  open: true,
  parts: [
    {
      lines: [[
        [seam, -edge],
        [bayCorner, -edge],
        [0, bayCorner - edge],
        [0, edge - bayCorner],
        [bayCorner, edge],
        [seam, edge],
      ]],
      points: [
        [0, bayCorner - edge],
        [bayCorner, -edge],
        [seam, -edge],
        [seam, edge],
        [bayCorner, edge],
        [0, edge - bayCorner],
      ],
      zIndex: 1,
    },
    {
      lines: [[
        [seam, -edge],
        [bayDepth - bayCorner, -edge],
        [bayDepth, bayCorner - edge],
        [bayDepth, edge - bayCorner],
        [bayDepth - bayCorner, edge],
        [seam, edge],
      ]],
      points: [
        [seam, -edge],
        [bayDepth - bayCorner, -edge],
        [bayDepth, bayCorner - edge],
        [bayDepth, edge - bayCorner],
        [bayDepth - bayCorner, edge],
        [seam, edge],
      ],
      zIndex: -1,
    },
  ],
  price: 5000,
};
