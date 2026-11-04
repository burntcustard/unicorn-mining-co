import { sampleOutline } from './curves';

const same = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8;
const cross = (a: number[], b: number[], c: number[]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const closed = (path: number[][]) =>
  same(path[0], path.at(-1)!) ? path : [...path, path[0].slice(0, 2)];

const area = (path: number[][]) =>
  sampleOutline(path).reduce((sum, a, index, points) => {
    const b = points[(index + 1) % points.length];

    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);

const reverse = (path: number[][]) => [
  path[0].slice(0, 2),
  ...path
    .slice(1)
    .toReversed()
    .map((edge, index) => {
      const destination = path[path.length - 2 - index];
      const controls =
        edge.length === 6
          ? [...edge.slice(4, 6), ...edge.slice(2, 4)]
          : edge.slice(2);

      return [...destination.slice(0, 2), ...controls];
    }),
];

const inside = (point: number[], polygon: number[][]) => {
  let result = false;

  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];

    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      result = !result;
    }
  });

  return result;
};

/*
 * Join opposite-wound contours with a doubled internal bridge. The fill and
 * collision outline retain the hole; separate stroke contours hide the bridge.
 */
export const polygonCutouts = (outline: number[][], cutouts: number[][][]) => {
  const outer = closed(outline);

  const holes = cutouts.map((path) => {
    const hole = closed(path);

    return area(hole) * area(outer) > 0 ? reverse(hole) : hole;
  });

  let joined = outer;
  const contours = [sampleOutline(outer), ...holes.map(sampleOutline)];

  for (const hole of holes) {
    const candidates = joined
      .slice(0, -1)
      .flatMap((to, outerIndex) =>
        hole.slice(0, -1).map((from, innerIndex) => ({
          to,
          from,
          outerIndex,
          innerIndex,
          distance: Math.hypot(to[0] - from[0], to[1] - from[1]),
        })),
      )
      .sort((a, b) => a.distance - b.distance);

    const bridge = candidates.find(({ to, from }) => {
      const middle = [(to[0] + from[0]) / 2, (to[1] + from[1]) / 2];

      if (
        !inside(middle, contours[0]) ||
        contours.slice(1).some((contour) => inside(middle, contour))
      ) {
        return false;
      }

      return ![...contours, sampleOutline(joined)].some((contour) =>
        contour.some((a, index) => {
          const b = contour[(index + 1) % contour.length];

          if (same(a, to) || same(b, to) || same(a, from) || same(b, from)) {
            return false;
          }

          return (
            cross(to, from, a) * cross(to, from, b) < -1e-8 &&
            cross(a, b, to) * cross(a, b, from) < -1e-8
          );
        }),
      );
    });

    if (!bridge) throw new Error('Hull cutout has no interior bridge');
    const { to, from, outerIndex, innerIndex } = bridge;
    const count = hole.length - 1;
    const loop = Array.from(
      { length: count },
      (_, index) => hole[((innerIndex + index) % count) + 1],
    );

    joined = [
      ...joined.slice(0, outerIndex + 1),
      from.slice(0, 2),
      ...loop,
      to.slice(0, 2),
      ...joined.slice(outerIndex + 1),
    ];
  }

  return { curvePoints: joined, shapeOutline: [outer, ...holes] };
};
