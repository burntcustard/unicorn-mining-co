import assert from 'node:assert/strict';
import { DrawingPath } from '../../src/client/utilities/drawing-path';
import { sampleOutline } from '../../src/client/utilities/curves';

const path = new DrawingPath(false);

path.moveTo(0, 0);
path.quadraticCurveTo(10, 20, 20, 0);
assert.deepEqual(path.contours[0].points.at(-1), [20, 0]);
assert(path.contours[0].points.some((point) => point[1] === 10));
path.bezierCurveTo(30, -20, 40, -20, 50, 0);
path.closePath();
assert.deepEqual(path.contours[0].points.at(-1), [50, 0]);
assert(
  path.contours[0].points.some((point) => point[0] === 35 && point[1] === -15),
);
assert(path.contours[0].closed);
assert.equal(path.circle, undefined);
const sampled = sampleOutline([
  [0, 0],
  [20, 0, 10, 20],
  [50, 0, 30, -20, 40, -20],
]);

assert.deepEqual(sampled[4], [10, 10]);
assert.deepEqual(sampled[12], [35, -15]);
assert.deepEqual(sampled.at(-1), [50, 0]);
