import { renderingLayers, type RenderingLayer } from '../rendering-layers';
import { rotatePoints } from '../geometry';
import { colors } from '../colors';
import type { StationDefinition } from './types';

type ShapeOutline = number[][];

const face = 250;
const corner = 182;
const inner = 138;
const innerCorner = 100;
const bayCorner = 6;
const bayDepth = 41;
const baySpan = 188;
const bay = face - bayDepth * 0.65;
const nose = bay + bayDepth;
const lip = baySpan / 2;
const gap = 3;
const bevel = gap * (Math.SQRT2 - 1);
const back = bay - gap;
const front = nose + gap;
const edge = lip + gap;
const cut = lip - bayCorner + bevel;
const notch = bay + bayCorner - bevel;
const chamfer = notch - back;
const side = [
  [
    [face, -corner],
    [face, -edge],
    [notch, -edge],
    [back, -cut],
    [inner, -innerCorner],
  ],
  [
    [face, corner],
    [inner, innerCorner],
    [back, cut],
    [notch, edge],
    [face, edge],
  ],
  [
    [inner, -innerCorner],
    [back, -cut],
    [back, cut],
    [inner, innerCorner],
  ],
];
const angles = Array.from({ length: 5 }, (_, index) => index * Math.PI * 0.4);
const core = angles.flatMap((angle) =>
  rotatePoints([[inner, -innerCorner]], angle),
) as ShapeOutline;
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

const stationSides = angles.flatMap((angle, sideIndex) =>
  side.map((shapeOutline, piece) => ({
    opening: sideIndex === 0 && piece === 2,
    shapeOutline: rotatePoints(shapeOutline, angle) as ShapeOutline,
  })),
);

const stationPanels = angles
  .slice(1)
  .map((angle) => rotatePoints(panel, angle) as ShapeOutline);

const geometry = {
  bay: {
    back: bay,
    corner: bayCorner,
    lip,
    nose,
    seam: bay + bayDepth / 2,
  },
  core,
  panels: stationPanels,
  sides: stationSides,
} satisfies {
  bay: {
    back: number;
    corner: number;
    lip: number;
    nose: number;
    seam: number;
  };
  core: ShapeOutline;
  panels: ShapeOutline[];
  sides: { opening: boolean; shapeOutline: ShapeOutline }[];
};

const specification = {
  localMovementRadius: 600,
  mass: 1e9,
  zIndex: renderingLayers.stationHull,
  bayFillAlpha: 4,
  bayFloorZIndex: renderingLayers.stationFloor,
  bayCeilingZIndex: renderingLayers.modulesAboveStationHull,
  bayGlowShades: colors.green,
  geometry,
};

const stationGeometry = specification.geometry;
const {
  back: bayBack,
  corner: bayBevel,
  lip: bayLip,
  nose: bayNose,
  seam,
} = stationGeometry.bay;

// Both halves share one glow outline, so light pools across the whole bay.
// Their glows draw on the layers below and above the station hull and modules.
const glow = [
  [bayBack, bayBevel - bayLip],
  [bayBack + bayBevel, -bayLip],
  [bayNose - bayBevel, -bayLip],
  [bayNose, bayBevel - bayLip],
  [bayNose, bayLip - bayBevel],
  [bayNose - bayBevel, bayLip],
  [bayBack + bayBevel, bayLip],
  [bayBack, bayLip - bayBevel],
];

// Both halves share the one glow, but their shape outlines stop at the seam
const halfBay = (points: number[][], zIndex: RenderingLayer) => ({
  disablePhysics: true,
  fillAlpha: specification.bayFillAlpha,
  glow,
  points,
  shades: specification.bayGlowShades,
  unclosed: true,
  zIndex,
});

export const corral = {
  ...specification,
  hullSegments: [
    ...stationGeometry.sides.map(({ opening, shapeOutline }) => ({
      // Only the socket with the bayBack in it can be flown through. The other
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
    // the bayBack floor
    halfBay(
      [
        [seam, -bayLip],
        [bayNose - bayBevel, -bayLip],
        [bayNose, bayBevel - bayLip],
        [bayNose, bayLip - bayBevel],
        [bayNose - bayBevel, bayLip],
        [seam, bayLip],
      ],
      specification.bayFloorZIndex,
    ),
    // The half nearer the station, drawn over the top of ships, so one that
    // flies all the way in disappears inside it
    halfBay(
      [
        [seam, bayLip],
        [bayBack + bayBevel, bayLip],
        [bayBack, bayLip - bayBevel],
        [bayBack, bayBevel - bayLip],
        [bayBack + bayBevel, -bayLip],
        [seam, -bayLip],
      ],
      specification.bayCeilingZIndex,
    ),
  ],
} satisfies StationDefinition;
