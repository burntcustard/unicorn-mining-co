/* global Buffer, process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

globalThis.Path2D = class {
  addPath() {}
  closePath() {}
  lineTo() {}
  moveTo() {}
};

const bundle = await rolldown({
  input: `${process.cwd()}/src/prism.js`,
  plugins: [{
    name: 'prism-test-exports',
    transform: (code, id) => id.endsWith('/src/prism.js') ?
      `${code}\nexport { joins, runsOf };` :
      undefined,
  }],
});
const { output } = await bundle.generate({ format: 'esm' });
const { traceBeam, drawSpectrum, joins: joinFaces, runsOf } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
await bundle.close();
const joins = (last, ray) => joinFaces(ray.hit, last.out.face, ray.out.face);

// An invisible seam halfway along the far side of a square. Test the public
// trace/render path: exactly seven band fills, not two separate seven-band fans.
for (const size of [10, 100, 1000]) {
  for (let frame = 0; frame < 120; frame++) {
    const rotation = frame * Math.PI / 60;
    const lamp = { x: 0, y: 0, activationProgress: 1,
      module: { lens: 0, reach: size * 20, spread: size * 2 } };
    const ship = { x: 0, y: 0, rotation, position: {} };
    const rock = {
      scenery: true, radius: size * 2,
      x: size * 4 * Math.cos(rotation), y: size * 4 * Math.sin(rotation),
      rotation: rotation + 0.17,
      position: { distanceTo: () => size * 4 },
      outline: [[-1, -1], [1, -1], [1, 0], [1, 1], [-1, 1]]
        .map(([x, y]) => [x * size, y * size]),
    };
    const beam = traceBeam(ship, lamp, [rock]);

    assert.equal(runsOf(beam).length, 1, `split at size ${size}, frame ${frame}`);
    let fills = 0;
    drawSpectrum({
      save() {}, restore() {}, fill() {
        fills++;
      },
      createLinearGradient: () => ({ addColorStop() {} }),
    }, lamp, beam);
    assert.equal(fills, 7);
  }
}

// Face joins in both directions, including the closing edge. Tiny errors must
// not become notches, but a real indentation must remain separate at every size.
for (const size of [0.1, 10, 10000]) {
  for (const bend of [-0.2, -1e-12, 0, 1e-12, 0.2]) {
    const points = [[0, 0], [1, 0], [2, bend], [2, 2], [0, 2]]
      .map(([x, y]) => [x * size, y * size]);
    const ray = (face) => ({ hit: points, out: { face } });

    assert.equal(joins(ray(0), ray(1)), bend > -0.1);
    assert.equal(joins(ray(1), ray(0)), bend > -0.1);
    assert.equal(joins(ray(4), ray(0)), true);
    assert.equal(joins(ray(0), ray(2)), false);
  }
}

console.log('Prism: 360 traced/rendered frames and corner regression cases passed.');
