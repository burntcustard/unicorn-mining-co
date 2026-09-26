import { rotatePoints } from '../../geometry';
import { type ShapeOutline } from '../../types';

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

export const stationGeometry = {
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
};
