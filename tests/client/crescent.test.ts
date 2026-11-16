import assert from 'node:assert/strict';
import Clipper from 'clipper-lib';
import { crescent } from '../../src/specs/ships/crescent';
import { thrusterCrescent } from '../../src/specs/modules/core/thrusters/thruster-crescent';
import { objectLineWidth } from '../../src/client/utilities/drawing';
import { outerEdges } from '../../src/client/utilities/polygon';
import { DrawingPath } from '../../src/client/utilities/drawing-path';
import { strokePath } from '../../src/client/utilities/path-mesh';
import type { ShapeOutline } from '../../src/client/types';

const precision = 1e6;
const near = (a: number, b: number, tolerance = 1e-5) =>
  Math.abs(a - b) < tolerance;

const integer = (points: number[][]) =>
  points.map(([x, y]) => ({
    X: Math.round(x * precision),
    Y: Math.round(y * precision),
  }));

const occupied = (points: number[][], width = objectLineWidth) => {
  const path = integer(points);

  if (!Clipper.Clipper.Orientation(path)) path.reverse();
  const offset = new Clipper.ClipperOffset(10);

  const result: { X: number; Y: number }[][] = [];

  offset.AddPath(
    path,
    Clipper.JoinType.jtMiter,
    Clipper.EndType.etClosedPolygon,
  );
  offset.Execute(result, (width * precision) / 2);
  assert.equal(result.length, 1, 'a finished outline stays one polygon');
  return Clipper.Clipper.CleanPolygon(result[0], 0.00001 * precision).map(
    ({ X, Y }) => [X / precision, Y / precision],
  );
};

const edges = (points: number[][]) =>
  points.map((a, index) => [a, points[(index + 1) % points.length]]);
const length = ([a, b]: number[][]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const pointLine = (p: number[], [a, b]: number[][]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );

  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

const gap = (a: number[][], b: number[][]) =>
  Math.min(
    ...a.flatMap((point) => edges(b).map((edge) => pointLine(point, edge))),
    ...b.flatMap((point) => edges(a).map((edge) => pointLine(point, edge))),
  );

const separated = (
  a: number[][],
  b: number[][],
  label: string,
  { expectedGap = 2.4 } = {},
) => {
  const clipper = new Clipper.Clipper();

  const overlap: { X: number; Y: number }[][] = [];

  clipper.AddPath(integer(a), Clipper.PolyType.ptSubject, true);
  clipper.AddPath(integer(b), Clipper.PolyType.ptClip, true);
  clipper.Execute(
    Clipper.ClipType.ctIntersection,
    overlap,
    Clipper.PolyFillType.pftNonZero,
    Clipper.PolyFillType.pftNonZero,
  );
  assert.equal(overlap.length, 0, `${label} finished outlines do not overlap`);
  const clearance = gap(a, b);

  assert(
    near(clearance, expectedGap, 0.01),
    `${label} has the intended ${expectedGap}-unit gap, received ${clearance}`,
  );
};

const parallel = ([a, b]: number[][], [c, d]: number[][]) =>
  near(
    ((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])) /
      (length([a, b]) * length([c, d])),
    0,
    0.001,
  );
const onLine = (point: number[], [a, b]: number[][]) =>
  near(
    ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) /
      length([a, b]),
    0,
    0.01,
  );
// Inspect the right half upright, with forward at the top of the page.
const upright = (points: number[][]) => points.map(([x, y]) => [y, -x]);
const hull = crescent.hullSegments;

assert.equal(
  hull.length,
  15,
  'the hull includes five center panels and paired fore inserts and rear panels',
);
assert(hull.every((segment) => segment.lineJoin === 'miter'));

for (const segment of hull.filter((part) => !part.core)) {
  const points = segment.points;

  assert(
    hull.some((other) => {
      if (other === segment) return false;
      const mirror = other.points;

      return (
        mirror.length === points.length &&
        points.every(
          (point, index) =>
            mirror[index].length === point.length &&
            point.every((value, axis) =>
              near(value, mirror[index][axis] * (axis % 2 ? -1 : 1)),
            ),
        )
      );
    }),
    'each side has an exact mirrored outline',
  );
}

const core = hull.find((segment) => segment.core).points;
const coreEdges = edges(core);

assert.equal(core.length, 4);
assert(core.every(([x, y]) => near(x, 0) || near(y, 0)));
assert(coreEdges.every((edge) => near(length(edge), length(coreEdges[0]))));
assert(
  near(
    (core[1][0] - core[0][0]) * (core[2][0] - core[1][0]) +
      (core[1][1] - core[0][1]) * (core[2][1] - core[1][1]),
    0,
  ),
  'the center diamond is a square with equal sides and right angles',
);

const centerPanels = hull.filter((part) =>
  part.points.every(([x, y]) => near(x, 0) || near(y, 0)),
);
const centerFacets = centerPanels.filter((part) => !part.core);
const centerOutlines = centerPanels.map((part) =>
  part.points.map((point) => [...point]),
) as ShapeOutline[];

assert.equal(
  centerPanels.length,
  5,
  'the center consists of five real hull panels',
);
assert.equal(centerFacets.length, 4);
assert(centerPanels.every((part) => part.health > 0));
assert(
  centerPanels.every((part) => part.points.length === 4),
  'center quadrilaterals use ordinary hull rendering without decorative faces',
);

const centerPaths = centerOutlines.map((points) => {
  const path = integer(points);

  if (!Clipper.Clipper.Orientation(path)) path.reverse();
  return path;
});

const centerAreas = centerPaths.map(
  (path) => Math.abs(Clipper.Clipper.Area(path)) / precision ** 2,
);
const facetAreas = centerPanels.flatMap((part, index) =>
  part.core ? [] : [centerAreas[index]],
);

assert(
  facetAreas.every((area) => near(area, facetAreas[0])),
  'all four outer faces have equal area',
);

const centerClipper = new Clipper.Clipper();

const centerUnion: { X: number; Y: number }[][] = [];

centerClipper.AddPaths(centerPaths, Clipper.PolyType.ptSubject, true);
centerClipper.Execute(
  Clipper.ClipType.ctUnion,
  centerUnion,
  Clipper.PolyFillType.pftNonZero,
  Clipper.PolyFillType.pftNonZero,
);

assert.equal(
  centerUnion.length,
  1,
  'the five center panels tile one connected outline',
);
const outerRadius = Math.max(
  ...centerOutlines.flatMap((points) =>
    points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]),
  ),
);
const outerDiamond = [
  [outerRadius, 0],
  [0, outerRadius],
  [-outerRadius, 0],
  [0, -outerRadius],
];
const outerArea =
  Math.abs(Clipper.Clipper.Area(integer(outerDiamond))) / precision ** 2;
const unionArea =
  Math.abs(Clipper.Clipper.Area(centerUnion[0])) / precision ** 2;

assert(
  near(unionArea, outerArea),
  'the center panels leave no holes in the outer diamond',
);
assert(
  near(
    centerAreas.reduce((total, area) => total + area, 0),
    unionArea,
  ),
  'the five center panels have no area overlap',
);

const centerStrokePaths = centerPanels.flatMap((part) => {
  const path = new DrawingPath(false);

  (part.shapeOutline ?? [part.points]).forEach((points) => {
    points.forEach(([x, y], index) => {
      if (index) {
        path.lineTo(x, y);
      } else {
        path.moveTo(x, y);
      }
    });

    if (!part.shapeOutline) path.closePath();
  });

  return strokePath(
    path,
    objectLineWidth,
    [],
    'butt',
    part.lineJoin,
  ).contours.flatMap(({ points }) => {
    const contour = integer(points);

    if (!Clipper.Clipper.Area(contour)) return [];

    if (!Clipper.Clipper.Orientation(contour)) contour.reverse();
    return [contour];
  });
});

const paintedCenterClipper = new Clipper.Clipper();

const silhouetteDifference: { X: number; Y: number }[][] = [];

paintedCenterClipper.AddPaths(
  [...centerPaths, ...centerStrokePaths],
  Clipper.PolyType.ptSubject,
  true,
);
paintedCenterClipper.AddPath(
  integer(occupied(outerDiamond)),
  Clipper.PolyType.ptClip,
  true,
);
paintedCenterClipper.Execute(
  Clipper.ClipType.ctXor,
  silhouetteDifference,
  Clipper.PolyFillType.pftNonZero,
  Clipper.PolyFillType.pftNonZero,
);

assert(
  silhouetteDifference.reduce(
    (area, path) =>
      area + Math.abs(Clipper.Clipper.Area(path)) / precision ** 2,
    0,
  ) < 0.0001,
  'the five painted panels retain the full mitered outer diamond without forked tips or protruding seams',
);

const centerGroups = outerEdges(centerOutlines);

assert.equal(centerGroups.length, 1, 'shared edges connect all center panels');
assert.equal(centerGroups[0].length, 5);
assert(
  centerOutlines[centerPanels.findIndex((part) => part.core)].edges.every(
    (exposed) => !exposed,
  ),
  'every core edge joins a real outer hull face',
);
assert(
  centerOutlines.every(
    (points, index) =>
      centerPanels[index].core || points.edges.filter(Boolean).length === 1,
  ),
  'each outer face exposes only its outer diamond edge',
);

const exposedCenterEdges = centerOutlines.flatMap((points) =>
  edges(points).filter((_, index) => points.edges[index]),
);

assert.equal(exposedCenterEdges.length, 4);
assert(
  exposedCenterEdges.every((edge) =>
    edges(outerDiamond).some((outer) =>
      edge.every((point) =>
        outer.some(([x, y]) => near(point[0], x) && near(point[1], y)),
      ),
    ),
  ),
  'the center hull exposes the original square diamond silhouette',
);

const mounts = hull.flatMap((part) => part.mounts ?? []);
const authoredCoordinates = [
  ...hull.flatMap((part) => [
    ...part.points.flat(),
    ...(part.shapeOutline ?? []).flat(2),
    ...(part.collisionParts ?? []).flat(2),
    ...(part.flightOffset ?? []),
    ...(part.mounts ?? []).flat().flatMap((point) => [point.x, point.y]),
  ]),
  ...thrusterCrescent.model.flatMap((part) => part.points.flat()),
];

assert(
  authoredCoordinates.every(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  ),
  'all authored hull, stroke, mount, flare, and flight-offset coordinates use at most two decimal places',
);
assert(
  mounts
    .flat()
    .filter((point) => point.fits.includes('thrusterCrescent'))
    .every((point) => Number.isInteger(point.x) && Number.isInteger(point.y)),
  'custom thruster mount positions use whole coordinates in the ship data',
);

assert.equal(
  mounts.length,
  6,
  'the center adds a flight controller and two cannon mounts after the original three module mounts',
);
assert.equal(hull[0].core, true);
assert.equal(
  hull[0].mounts.length,
  1,
  'the core retains its power plant mount',
);
assert.deepEqual(
  crescent.initialLoadout.map(({ mount }) => mount),
  [0, 1, 2, 3],
);

assert(
  crescent.initialLoadout.every(({ mount, module }) =>
    mounts[mount].some((point) => point.fits.includes(module)),
  ),
  'the unchanged loadout still fits its original mount indexes',
);

const right = hull.filter((part) => part.points.every((point) => point[1] > 0));
const whiteWings = hull.filter((part) => part.essential);
const white = right.find((part) => part.essential);
const violet = right.find((part) => part.points.length === 5);
const whiteFootprint = upright(occupied(white.points));
const violetFootprint = upright(occupied(violet.points));
const violetEdges = edges(violetFootprint);

assert.equal(whiteWings.length, 2);
assert(
  whiteWings.every((part) => part.points.every((point) => point.length === 2)),
  'both white wings are authored entirely with straight polygon edges',
);

for (const wing of whiteWings) {
  assert(
    wing.collisionParts?.length,
    'each white wing has authored collision parts',
  );

  for (const points of wing.collisionParts) {
    assert(
      points.length >= 3 && points.length <= 8,
      'each white collision part stays within the convex collider vertex limit',
    );

    const turns = points
      .map((a, index) => {
        const b = points[(index + 1) % points.length];
        const c = points[(index + 2) % points.length];

        return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      })
      .filter((turn) => !near(turn, 0));

    assert(
      turns.length >= 3 &&
        turns.every((turn) => Math.sign(turn) === Math.sign(turns[0])),
      'each white collision part is convex and has positive area',
    );
  }

  const wingArea = Math.abs(Clipper.Clipper.Area(integer(wing.points)));

  assert(
    wing.collisionParts.every(
      (points) =>
        Math.abs(Clipper.Clipper.Area(integer(points))) > wingArea * 0.02,
    ),
    'white collision parts avoid tiny slivers along the bow',
  );

  const collisionPaths = wing.collisionParts.map((points) => {
    const path = integer(points);

    if (!Clipper.Clipper.Orientation(path)) path.reverse();
    return path;
  });

  const clipper = new Clipper.Clipper();

  const difference: { X: number; Y: number }[][] = [];

  clipper.AddPaths(collisionPaths, Clipper.PolyType.ptSubject, true);
  clipper.AddPath(integer(wing.points), Clipper.PolyType.ptClip, true);
  clipper.Execute(
    Clipper.ClipType.ctXor,
    difference,
    Clipper.PolyFillType.pftNonZero,
    Clipper.PolyFillType.pftNonZero,
  );

  assert(
    near(
      difference.reduce(
        (area, path) =>
          area + Math.abs(Clipper.Clipper.Area(path)) / precision ** 2,
        0,
      ),
      0,
    ),
    'the authored collision parts cover the straight white outline without gaps or protrusions',
  );
  assert(
    near(
      collisionPaths.reduce(
        (area, path) =>
          area + Math.abs(Clipper.Clipper.Area(path)) / precision ** 2,
        0,
      ),
      Math.abs(Clipper.Clipper.Area(integer(wing.points))) / precision ** 2,
    ),
    'white collision parts do not overlap in area',
  );
}

const forePanels = hull.filter(
  (part) =>
    !part.core &&
    part.points.length === 4 &&
    (part.points.every(([, y]) => y > 0) ||
      part.points.every(([, y]) => y < 0)),
);

assert.equal(
  forePanels.length,
  2,
  'both fore inserts have four straight sides',
);
assert(
  forePanels.every((part) => part.points.every((point) => point.length === 2)),
  'fore inserts use straight vertices without curve controls',
);

const forePanel = forePanels.find((part) => right.includes(part));
const foreFootprint = upright(occupied(forePanel.points));
const foreEdges = edges(foreFootprint);
const foreFlanks = foreEdges.filter(([a, b]) => near(a[0], b[0]));
const foreShoulders = foreEdges.filter((edge) =>
  parallel(edge, [
    [0, 0],
    [Math.sqrt(3), 1],
  ]),
);
const foreInnerFlank = foreEdges.find(
  (edge) => !foreFlanks.includes(edge) && !foreShoulders.includes(edge),
);
const innerGold = right
  .filter((part) => part.points.length === 6)
  .sort(
    (a, b) =>
      Math.max(...a.points.map((point) => point[1])) -
      Math.max(...b.points.map((point) => point[1])),
  )[0];
const innerGoldFootprint = upright(occupied(innerGold.points));

assert.equal(
  foreFootprint.length,
  4,
  'the finished fore outline stays a quadrilateral',
);
assert.equal(foreFlanks.length, 1, 'the fore insert outer flank is vertical');
assert(foreInnerFlank, 'the fore insert inner flank is slanted');
assert.equal(foreShoulders.length, 2);
assert(
  foreShoulders.every((edge) =>
    parallel(edge, [
      [0, 0],
      [Math.sqrt(3), 1],
    ]),
  ) && parallel(foreShoulders[0], foreShoulders[1]),
  'the top and bottom fore shoulders share the fitting-facing 30-degree angle',
);
assert(
  foreShoulders.every((shoulder) =>
    edges(innerGoldFootprint).some((edge) => parallel(edge, shoulder)),
  ),
  'fore insert shoulders match the neighboring inner gold fitting',
);

const foreOuterFlank = foreFlanks.reduce((a, b) => (a[0][0] > b[0][0] ? a : b));
const goldOuterX = Math.max(...innerGoldFootprint.map(([x]) => x));
const goldOuterFlank = edges(innerGoldFootprint).find(
  ([a, b]) => near(a[0], b[0]) && near(a[0], goldOuterX),
);

assert(goldOuterFlank, 'the inner gold fitting has an outer vertical flank');
assert(
  near(foreOuterFlank[0][0], goldOuterX),
  'the fore insert and inner gold outer flanks share one straight alignment',
);

const whiteForwardBoundary = edges(whiteFootprint).find(
  ([a, b]) =>
    near(a[0], b[0]) &&
    near(a[0] - goldOuterX, 2.4) &&
    Math.min(a[1], b[1]) <
      Math.min(...foreOuterFlank.map((point) => point[1])) + 0.01 &&
    Math.max(a[1], b[1]) >
      Math.max(...goldOuterFlank.map((point) => point[1])) - 0.01,
);

assert(
  whiteForwardBoundary,
  'one white vertical boundary passes both aligned flanks with a 2.4-unit gap and no forward centerward step',
);
separated(whiteFootprint, foreFootprint, 'white/fore insert');

separated(foreFootprint, innerGoldFootprint, 'fore insert/inner gold', {
  expectedGap: 7.02,
});

const foreTop = foreShoulders.reduce((a, b) =>
  a[0][1] + a[1][1] < b[0][1] + b[1][1] ? a : b,
);
const foreFrontInnerCorner = foreTop.reduce((a, b) => (a[0] < b[0] ? a : b));
const whiteTopLip = edges(whiteFootprint).find(
  (edge) =>
    parallel(edge, foreTop) &&
    near(pointLine(foreFrontInnerCorner, edge), 2.4, 0.01),
);

assert(whiteTopLip, 'the white top lip follows the fore insert shoulder');
const whiteLipStart = whiteTopLip.reduce((a, b) => (a[0] < b[0] ? a : b));
const lipOffset = whiteLipStart.map(
  (value, axis) => value - foreFrontInnerCorner[axis],
);
const whiteBowInnerEdge = edges(whiteFootprint).find(
  (edge) =>
    length(edge) > length(foreInnerFlank) &&
    parallel(edge, foreInnerFlank) &&
    edge.every((point) => onLine(point, foreInnerFlank)),
);

assert(
  whiteBowInnerEdge,
  'both ends of the straight white inner bow continue the fore insert inner flank line',
);

assert(
  white.points.some((point, index) => {
    if (!index || point.length !== 2) return false;
    const edge = upright([white.points[index - 1], point]);

    return (
      length(edge) > length(foreInnerFlank) && parallel(edge, foreInnerFlank)
    );
  }),
  'the white inner bow uses a native straight segment rather than a shallow curve',
);

assert(
  whiteBowInnerEdge.some((point) =>
    near(
      Math.hypot(point[0] - whiteLipStart[0], point[1] - whiteLipStart[1]),
      0,
      0.01,
    ),
  ),
  'the white top lip starts where the straight inner bow ends',
);
assert(
  lipOffset[0] < 0 &&
    lipOffset[1] < 0 &&
    Math.hypot(...lipOffset) > 2.4 &&
    onLine(whiteLipStart, foreInnerFlank),
  'the bow-to-insert opening runs forward along the common slanted line while the top lip keeps its normal gap',
);

assert.equal(
  violetFootprint.length,
  5,
  'the violet panel has five straight sides',
);
const shoulder = violetEdges.find(([a, b]) => near(b[0] - a[0], a[1] - b[1]));
const innerFlank = violetEdges.find(
  ([a, b]) =>
    near(a[0], b[0]) && a[0] < Math.max(...violetFootprint.map((p) => p[0])),
);

assert(shoulder, 'the violet inner shoulder is 45 degrees');
assert(innerFlank, 'the violet lower inner flank is vertical');
assert(
  near(
    Math.min(...innerFlank.map((point) => point[1])) + 4.5,
    Math.max(...whiteFootprint.map((point) => point[1])),
    0.01,
  ),
  'the violet shoulder extends forward of the white ledge',
);

const mount = violet.mounts
  .flat()
  .find((point) => point.fits.includes('thrusterCrescent'));
const flare = thrusterCrescent.model[0];
const oppositeMount = hull
  .find((part) => part.points.length === 5 && part !== violet)
  .mounts.flat()
  .find((point) => point.fits.includes('thrusterCrescent'));
const flarePointsAt = (mountY: number) =>
  flare.points.map(([x, y]) => [
    x,
    y * (flare.mirrorWithMount ? Math.sign(mountY) || 1 : 1),
  ]);
const flarePoints = flarePointsAt(mount.y);
const oppositeFlarePoints = flarePointsAt(oppositeMount.y);

assert(near(mount.x, oppositeMount.x) && near(mount.y, -oppositeMount.y));
assert(
  flarePoints.every((point, index) =>
    point.every((value, axis) =>
      near(value, oppositeFlarePoints[index][axis] * (axis ? -1 : 1)),
    ),
  ),
  'both fitted flares have mirrored outlines and mount positions',
);
const flareFootprint = upright(
  occupied(
    flarePoints.map(([x, y]) => [x + mount.x, y + mount.y]),
    flare.lineWidth,
  ),
);

assert.equal(flare.points.length, 5);
assert.equal(flareFootprint.length, 5);
assert.equal(flare.lineJoin, 'miter');
const cap = edges(flareFootprint).find(([a, b]) => near(a[1], b[1]));

assert(cap, 'the flare has a horizontal cap');
const capY = cap[0][1];
const capLeft = cap.reduce((a, b) => (a[0] < b[0] ? a : b));
const capRight = cap.reduce((a, b) => (a[0] > b[0] ? a : b));
const remaining = flareFootprint.filter((point) => !near(point[1], capY));
const tail = remaining.reduce((a, b) => (a[1] > b[1] ? a : b));
const innerKnee = remaining
  .filter((point) => point !== tail)
  .reduce((a, b) => (a[0] < b[0] ? a : b));
const outerKnee = remaining.find(
  (point) => point !== tail && point !== innerKnee,
);
const shortFace = [innerKnee, capLeft];

assert(
  edges(flareFootprint).every((edge) => length(edge) >= length(cap) - 1e-5),
  'the reference flare keeps its short cap rather than a broad rectangular top',
);
assert(
  parallel(
    [
      [0, 0],
      [
        Math.abs(capLeft[0] - innerKnee[0]),
        Math.abs(capLeft[1] - innerKnee[1]),
      ],
    ],
    [
      [0, 0],
      [Math.sqrt(3), 1],
    ],
  ),
  'the reference flare has short 30-degree diagonals',
);
assert(parallel(shortFace, [outerKnee, tail]));
assert(
  parallel([capRight, outerKnee], [tail, innerKnee]),
  'the flare outer long edge is parallel to its inner long edge',
);

for (const face of [[tail, innerKnee], shortFace]) {
  assert(
    violetEdges.some(
      (edge) =>
        parallel(edge, face) &&
        near(
          Math.min(...face.map((point) => pointLine(point, edge))),
          2.4,
          0.01,
        ),
    ),
    'each inboard flare face shares the adjacent violet angle and gap',
  );
}

const shelf = edges(whiteFootprint).find(
  ([a, b]) => near(a[1], b[1]) && near(capY - a[1], 2.4),
);

assert(
  shelf,
  'the white shelf and flare cap stay horizontal with the shared gap',
);
assert(
  near(
    Math.min(...shelf.map((point) => point[0])),
    Math.min(...cap.map((point) => point[0])) + 0.1,
    0.01,
  ) &&
    near(
      Math.max(...shelf.map((point) => point[0])),
      Math.max(...cap.map((point) => point[0])) + 0.1,
      0.01,
    ),
  'the flare cap has a uniform small optical inset from the white shelf',
);
separated(whiteFootprint, violetFootprint, 'white/violet');
separated(whiteFootprint, flareFootprint, 'white/flare');
separated(violetFootprint, flareFootprint, 'violet/flare');

for (const gold of right.filter((part) => part.points.length === 6)) {
  separated(whiteFootprint, upright(occupied(gold.points)), 'white/gold');
}

const rearEnd = shelf.reduce((a, b) => (a[0] > b[0] ? a : b));
const rearTrailingEdge = edges(whiteFootprint).find(
  (edge) =>
    edge.includes(rearEnd) &&
    edge.some((point) => point[0] > rearEnd[0] && point[1] < rearEnd[1]),
);

assert(
  rearTrailingEdge,
  'the straight rear trailing edge meets the horizontal shelf',
);
const rearEndIndex = whiteFootprint.indexOf(rearEnd);
const rearNextIndex = whiteFootprint.indexOf(
  rearTrailingEdge.find((point) => point !== rearEnd),
);
const rearDirection =
  (rearNextIndex - rearEndIndex + whiteFootprint.length) %
    whiteFootprint.length ===
  1
    ? 1
    : -1;
const rearPoint = (offset: number) =>
  whiteFootprint[
    (((rearEndIndex + rearDirection * offset) % whiteFootprint.length) +
      whiteFootprint.length) %
      whiteFootprint.length
  ];
const rearContour = [rearEnd];
let rearSocketReturn: number[][] | undefined;

for (let index = 1; index < whiteFootprint.length; index++) {
  const point = rearPoint(index);
  const next = rearPoint(index + 1);

  rearContour.push(point);

  if (
    next[0] < point[0] &&
    next[1] < point[1] &&
    parallel(
      [point, next],
      [
        [0, 0],
        [1, Math.sqrt(3)],
      ],
    )
  ) {
    rearSocketReturn = [point, next];
    break;
  }
}

assert(rearSocketReturn, 'the rear contour reaches the gold socket return');
assert.equal(
  rearContour.length,
  5,
  'the rear contour has five vertices joined by four straight edges',
);
const rearStart = rearContour[rearContour.length - 1];
const shelfAngle = Math.abs(
  (Math.atan2(rearContour[1][1] - rearEnd[1], rearContour[1][0] - rearEnd[0]) *
    180) /
    Math.PI,
);

assert(
  shelfAngle > 30 && shelfAngle < 50,
  'the straight rear edge retains a sharp corner at the shelf',
);

const rearTurns = rearContour.slice(1, -1).map((point, index) => {
  const previous = rearContour[index];
  const next = rearContour[index + 2];
  const before = [point[0] - previous[0], point[1] - previous[1]];
  const after = [next[0] - point[0], next[1] - point[1]];

  return (
    (Math.atan2(
      before[0] * after[1] - before[1] * after[0],
      before[0] * after[0] + before[1] * after[1],
    ) *
      180) /
    Math.PI
  );
});

assert(
  rearTurns.every((turn) => Math.sign(turn) === Math.sign(rearTurns[0])),
  'the four rear edges turn monotonically without reversing curvature',
);
assert(
  rearTurns.every((turn) => Math.abs(turn) > 0.1 && Math.abs(turn) <= 12),
  'rear vertices make gentle nonzero turns instead of sharp kinks or collinear subdivisions',
);
const outerGold = right
  .filter((part) => part.points.length === 6)
  .sort(
    (a, b) =>
      Math.max(...b.points.map((point) => point[1])) -
      Math.max(...a.points.map((point) => point[1])),
  )[0];
const outerCenter =
  outerGold.points.reduce((sum, point) => sum + point[1], 0) /
  outerGold.points.length;
const outerGoldFootprint = upright(occupied(outerGold.points));
const goldForeTip = outerGoldFootprint.reduce((a, b) => (a[1] < b[1] ? a : b));
const goldForeFaces = edges(outerGoldFootprint).filter((edge) =>
  edge.includes(goldForeTip),
);
const goldOutboardForeFace = goldForeFaces.find((edge) =>
  edge.some((point) => point[0] > goldForeTip[0]),
);
const goldInboardForeFace = goldForeFaces.find((edge) =>
  edge.some((point) => point[0] < goldForeTip[0]),
);

assert(
  goldOutboardForeFace && goldInboardForeFace,
  'the outer gold fore tip has two pointed shoulders',
);
const alignedWhiteForeCorner = whiteFootprint.find(
  (point) =>
    point[1] < goldForeTip[1] &&
    Math.hypot(point[0] - goldForeTip[0], point[1] - goldForeTip[1]) <
      length(goldOutboardForeFace) &&
    onLine(point, goldOutboardForeFace) &&
    edges(whiteFootprint).some(
      (edge) => edge.includes(point) && parallel(edge, goldInboardForeFace),
    ),
);

assert(
  alignedWhiteForeCorner,
  'the white fore corner continues the outer gold outboard shoulder beyond its tip',
);
const whiteForeMatingFace = edges(whiteFootprint).find(
  (edge) =>
    edge.includes(alignedWhiteForeCorner) &&
    parallel(edge, goldInboardForeFace),
);

assert(
  near(gap(whiteForeMatingFace, goldInboardForeFace), 2.4, 0.01),
  'the aligned white fore corner keeps its mating face parallel and 2.4 units from the opposite gold shoulder',
);

const nativeWhitePoints = upright(white.points);
const nativeForeFace = edges(nativeWhitePoints).find((edge) =>
  parallel(edge, goldInboardForeFace),
);
const nativeForeCorner = nativeForeFace.reduce((a, b) => (a[1] < b[1] ? a : b));
const nativeBowTip = nativeWhitePoints.reduce((a, b) => (a[1] < b[1] ? a : b));
const nativeBowTipIndex = nativeWhitePoints.indexOf(nativeBowTip);
const nativeForeCornerIndex = nativeWhitePoints.indexOf(nativeForeCorner);
const forwardBowLength =
  (nativeForeCornerIndex - nativeBowTipIndex + nativeWhitePoints.length) %
  nativeWhitePoints.length;
const reverseBowLength =
  (nativeBowTipIndex - nativeForeCornerIndex + nativeWhitePoints.length) %
  nativeWhitePoints.length;
const bowDirection = forwardBowLength <= reverseBowLength ? 1 : -1;
const outerBowPointCount = Math.min(forwardBowLength, reverseBowLength) + 1;
const outerBow = Array.from(
  { length: outerBowPointCount },
  (_, index) =>
    nativeWhitePoints[
      (nativeBowTipIndex + bowDirection * index + nativeWhitePoints.length) %
        nativeWhitePoints.length
    ],
);

assert(
  outerBowPointCount >= 8 && outerBowPointCount <= 10,
  'the outer bow uses eight to ten real vertices instead of a sampled curve',
);

const outerBowTurns = outerBow.slice(1, -1).map((point, index) => {
  const previous = outerBow[index];
  const next = outerBow[index + 2];
  const before = [point[0] - previous[0], point[1] - previous[1]];
  const after = [next[0] - point[0], next[1] - point[1]];

  return (
    (Math.atan2(
      before[0] * after[1] - before[1] * after[0],
      before[0] * after[0] + before[1] * after[1],
    ) *
      180) /
    Math.PI
  );
});

assert(
  outerBowTurns.every(
    (turn) => Math.sign(turn) === Math.sign(outerBowTurns[0]),
  ),
  'outer bow edge directions turn monotonically without reversing curvature',
);
assert(
  outerBowTurns.every((turn) => Math.abs(turn) > 0.1 && Math.abs(turn) <= 12),
  'each outer bow vertex makes a gentle nonzero turn instead of a sharp kink or collinear subdivision',
);

for (const gold of right.filter((part) => part.points.length === 6)) {
  const capSlope = gold === outerGold ? Math.sqrt(3) : 1 / Math.sqrt(3);

  assert(
    edges(upright(gold.points)).every(
      ([a, b]) =>
        near(a[0], b[0]) ||
        parallel(
          [
            [0, 0],
            [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])],
          ],
          [
            [0, 0],
            [1, capSlope],
          ],
        ),
    ),
    'yellow fittings keep vertical flanks and their shared pointed cap angles',
  );
}

assert(
  rearStart[0] < outerCenter,
  'the lower socket return meets the rear contour before reaching the fitting centerline',
);

const flightOffsetOf = (
  index: number,
  visited = new Set<number>(),
): number[] | undefined => {
  if (visited.has(index)) return;
  visited.add(index);
  const part = hull[index];

  if (part.flightOffset) return part.flightOffset;

  for (const parent of part.connections ?? []) {
    const offset = flightOffsetOf(parent, visited);

    if (offset) return offset;
  }
};

// A linearly translated vertex reaches its greatest radius at an end pose.
const paintedHullRadius = Math.max(
  ...hull.flatMap((part, index) => {
    const offset = flightOffsetOf(index) ?? [0, 0];
    const outline = occupied(part.points);

    return [0, 1].flatMap((progress) =>
      outline.map(([x, y]) =>
        Math.hypot(x + offset[0] * progress, y + offset[1] * progress),
      ),
    );
  }),
);

assert(
  crescent.radius >= paintedHullRadius,
  `the ship radius contains the finished hull in combat and flight poses (${paintedHullRadius})`,
);
