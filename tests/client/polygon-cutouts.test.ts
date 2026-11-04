import assert from 'node:assert/strict';
import { polygonCutouts } from '../../src/client/utilities/polygon-cutouts';
import { sampleOutline } from '../../src/client/utilities/curves';
import { triangulate } from '../../src/client/utilities/triangulate';

const area = (points: number[][]) =>
  Math.abs(
    points.reduce((sum, a, index) => {
      const b = points[(index + 1) % points.length];

      return sum + a[0] * b[1] - a[1] * b[0];
    }, 0),
  ) / 2;

const outer = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
];
const holes = [
  [
    [4, 4],
    [8, 4],
    [8, 8],
    [4, 8],
  ],
  [
    [12, 12],
    [16, 12],
    [14, 16],
  ],
];

for (const mirrored of [false, true]) {
  const transform = (path: number[][]) =>
    path.map(([x, y]) => [mirrored ? -x : x, y]);
  const geometry = polygonCutouts(transform(outer), holes.map(transform));
  const triangles = triangulate(sampleOutline(geometry.curvePoints));

  assert(triangles, 'hole bridges must produce a triangulable outline');
  let filledArea = 0;

  for (let index = 0; index < triangles.length; index += 6) {
    filledArea += area([
      [triangles[index], triangles[index + 1]],
      [triangles[index + 2], triangles[index + 3]],
      [triangles[index + 4], triangles[index + 5]],
    ]);
  }

  assert(
    Math.abs(
      filledArea -
        (area(outer) - holes.reduce((sum, hole) => sum + area(hole), 0)),
    ) < 1e-6,
    'triangles must cover the material around the holes only',
  );
  assert.equal(
    geometry.shapeOutline.length,
    3,
    'stroke contours omit the internal bridges',
  );
}
