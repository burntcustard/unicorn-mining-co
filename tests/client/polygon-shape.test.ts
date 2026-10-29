import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { testBuildPlugin } from '../support/build-plugin';

const root = process.cwd();
const entry = `${root}/src/__polygon_shape_test.ts`;
const captured = [
  [14.006162036981271, -2.97317155034599],
  [22.006145009196764, -2.9566656646630287],
  [21.993765594934544, 3.0433215644985907],
  [13.993782622719051, 3.0268156788156295],
  [13.998940711994976, 0.526820999998288],
  [16.998934326575785, 0.5330107071293986],
  [17.000997562286155, -0.4669871643975379],
  [14.001003947705346, -0.47317687152864846],
];
const source = `
import { PolygonShape } from '${root}/src/client/collision/shape/polygon-shape.ts';
import { moduleSpecList } from '${root}/src/specs/modules/index.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';
export const models = moduleSpecList
  .filter(spec => spec.behavior === 'weapon' || spec.behavior === 'beam')
  .flatMap(spec => spec.model.flatMap(part => part.points ? [part.points] : []));
export const build = (points, previous = []) => {
  const shape = new PolygonShape(previous.map(([x, y]) => Vec.create(x, y)));
  shape._set(points.map(([x, y]) => Vec.create(x, y)));
  return [shape.m_vertices.map(point => [point.x, point.y]), [shape.m_centroid.x, shape.m_centroid.y], shape.m_normals.length, shape.m_count];
};
`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entry,
    plugins: [
      {
        name: 'polygon-shape-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) => (id === entry ? source : undefined),
      },
      buildPrePlugin(),
      ...(production ? [testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  const { build, models } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );

  const verify = (points: number[][]) => {
    const [vertices, centroid] = build(points);

    assert.equal(
      vertices.length,
      4,
      'collinear inserts must not enter the convex hull',
    );
    assert(centroid.every(Number.isFinite));

    const area =
      vertices.reduce((sum: number, point: number[], index: number) => {
        const next = vertices[(index + 1) % vertices.length];

        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0) / 2;

    assert(
      Math.abs(area - 48) < 1e-6,
      'the hull must retain its enclosing rectangle rather than a fallback box',
    );

    for (let index = 0; index < vertices.length; index++) {
      const from = vertices[index];
      const to = vertices[(index + 1) % vertices.length];

      assert(
        points.every(
          ([x, y]) =>
            (to[0] - from[0]) * (y - from[1]) -
              (to[1] - from[1]) * (x - from[0]) >=
            -1e-8,
        ),
        'the convex hull must contain all input points',
      );
    }
  };

  verify(captured);
  const [fallback, center, normalCount, count] = build(
    [
      [0, 0],
      [1, 1],
      [10, NaN],
    ],
    [
      [10, 0],
      [12, 0],
      [13, 1],
      [12, 2],
      [10, 2],
      [9, 1],
    ],
  );

  assert(
    fallback.flat().every(Number.isFinite),
    'a failed hull walk must terminate with finite geometry',
  );
  assert.equal(fallback.length, 4, 'fallback must discard old vertices');
  assert.equal(normalCount, 4, 'fallback must discard old normals');
  assert.equal(count, 4);
  assert.deepEqual(center, [0, 0], 'fallback must reset the old center');

  for (const points of models) {
    for (const angle of [0, 0.002, Math.PI / 4, Math.PI / 2]) {
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const rotated = points.map(([x, y]: number[]) => [
        x * cos - y * sin,
        x * sin + y * cos,
      ]);
      const [vertices, centroid] = build(rotated);

      assert(
        centroid.every(Number.isFinite),
        'weapon model hulls must have finite centers',
      );
      assert(
        vertices.every(([x, y]: number[]) =>
          rotated.some(([px, py]: number[]) => x === px && y === py),
        ),
        'weapon models must form their own hull without using the fallback box',
      );
    }
  }

  const outline = [
    [13, -3],
    [21, -3],
    [21, 3],
    [13, 3],
    [13, 0.5],
    [16, 0.5],
    [16, -0.5],
    [13, -0.5],
  ];

  for (let step = 0; step < 1440; step++) {
    const angle = (step * Math.PI) / 720;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    verify(outline.map(([x, y]) => [1 + x * cos - y * sin, x * sin + y * cos]));
  }
}
