import { Station } from '../station';
import { colors } from '../../colors';
import { stationGeometry } from './corral-geometry';

const { back: bay, corner: bayCorner, lip, nose, seam } = stationGeometry.bay;

// Both halves as one shape outline, so the light pools along the whole bay rather
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

// Both halves share the one glow, but their shape outlines stop at the seam
const halfBay = (points: number[][], zIndex: number) => ({
  disablePhysics: true,
  fillAlpha: 4,
  glow,
  points,
  shades: colors.green,
  unclosed: true,
  zIndex,
});

export class Corral extends Station {
  static localMovementRadius = 600;
  static mass = 1e9;
  static zIndex = 2;
  static hullSegments = [
    ...stationGeometry.sides.map(({ opening, shapeOutline }) => ({
      // Only the socket with the bay in it can be flown through. The other
      // four are the same shape repeated, and are as solid as the rest
      disablePhysics: opening,
      points: shapeOutline,
    })),
    {
      disablePhysics: true,
      dockSegment: true,
      points: stationGeometry.core,
    },
    // After the sides, so that they are drawn over the socket edges they fill
    ...stationGeometry.panels.map((points) => ({ points })),
    // The half out in the open, drawn behind ships, so one arriving sits on
    // the bay floor
    halfBay(
      [
        [seam, -lip],
        [nose - bayCorner, -lip],
        [nose, bayCorner - lip],
        [nose, lip - bayCorner],
        [nose - bayCorner, lip],
        [seam, lip],
      ],
      -3,
    ),
    // The half nearer the station, drawn over the top of ships, so one that
    // flies all the way in disappears inside it
    halfBay(
      [
        [seam, lip],
        [bay + bayCorner, lip],
        [bay, lip - bayCorner],
        [bay, bayCorner - lip],
        [bay + bayCorner, -lip],
        [seam, -lip],
      ],
      3,
    ),
  ];
}
