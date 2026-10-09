import { renderingLayers, type RenderingLayer } from '../rendering-layers';
import { rotatePoints } from '../geometry';
import { colors } from '../colors';
import type { StationSpec } from './types';

type ShapeOutline = number[][];

export const createCorral = ({
  sideCount,
  baySides,
}: {
  sideCount: number;
  baySides: number[];
}) => {
  const face = 250;
  const corner = face * Math.tan(Math.PI / sideCount);
  const inner = 138;
  const innerCorner = inner * Math.tan(Math.PI / sideCount);
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
  const angles = Array.from(
    { length: sideCount },
    (_, index) => (index * Math.PI * 2) / sideCount,
  );
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
      opening: baySides.includes(sideIndex) && piece === 2,
      shapeOutline: rotatePoints(shapeOutline, angle) as ShapeOutline,
    })),
  );

  const stationPanels = angles
    .filter((_, index) => !baySides.includes(index))
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
    bayFillAlpha: 0.3,
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
  // Their glows draw below the bay floor and above the bay ceiling.
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
  const halfBay = (
    points: number[][],
    zIndex: RenderingLayer,
    angle: number,
  ) => ({
    disablePhysics: true,
    fillAlpha: specification.bayFillAlpha,
    glow: rotatePoints(glow, angle),
    points: rotatePoints(points, angle),
    shades: specification.bayGlowShades,
    unclosed: true,
    zIndex,
  });

  return {
    dockingBays: baySides.map((index) => angles[index]),
    ...specification,
    hullSegments: [
      ...stationGeometry.sides.map(({ opening, shapeOutline }) => ({
        // Bay sockets are open; the remaining sockets have solid panels.
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
      ...baySides.flatMap((index) => [
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
          angles[index],
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
          angles[index],
        ),
      ]),
    ],
  } satisfies StationSpec;
};
