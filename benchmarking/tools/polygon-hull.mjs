import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'polygon-hull-benchmark',
  plugins: [
    {
      name: 'polygon-hull-benchmark',
      resolveId: (id) =>
        id === 'polygon-hull-benchmark'
          ? '\0polygon-hull-benchmark'
          : undefined,
      load: (id) =>
        id === '\0polygon-hull-benchmark'
          ? `export { PolygonShape } from '${resolve('src/shared/collision/shape/polygon-shape.ts')}';`
          : undefined,
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const { PolygonShape } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
let vertexCount = 0;

for (const count of [8, 20, 30]) {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (index * Math.PI * 2) / count;

    return { x: Math.cos(angle) * 20, y: Math.sin(angle) * 20 };
  });
  const make = () => {
    vertexCount += new PolygonShape(points).m_count;
  };

  for (let index = 0; index < 3000; index++) make();
  const samples = [];

  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();

    for (let index = 0; index < 3000; index++) make();
    samples.push(((performance.now() - start) * 1000) / 3000);
  }

  console.log(
    JSON.stringify({
      points: count,
      medianMicroseconds: median(samples),
      vertexCount,
    }),
  );
}
