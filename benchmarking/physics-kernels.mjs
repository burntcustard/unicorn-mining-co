import { performance } from 'node:perf_hooks';

const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];

const measure = (name, iterations, run) => {
  let checksum = 0;

  for (let index = 0; index < iterations; index++) checksum += run(index);
  const samples = [];

  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();

    for (let index = 0; index < iterations; index++) checksum += run(index);
    samples.push(((performance.now() - start) * 1e6) / iterations);
  }

  console.log(
    JSON.stringify({ name, nanosecondsPerCall: median(samples), checksum }),
  );
};

for (const count of [2, 30]) {
  const points = Array.from({ length: count }, (_, index) => ({
    x: index * 0.13,
    y: index * -0.27,
  }));
  const limit = 0.001;

  measure(`for-${count}`, 300000, (index) => {
    let found = false;
    const offset = (index & 15) * 0.01;

    for (let point = 0; point < points.length; point++) {
      const dx = points[point].x - offset;
      const dy = points[point].y + offset;

      if (dx * dx + dy * dy < limit) {
        found = true;
        break;
      }
    }
    return found ? 1 : 0;
  });

  measure(`some-${count}`, 300000, (index) => {
    const offset = (index & 15) * 0.01;

    return points.some((point) => {
      const dx = point.x - offset;
      const dy = point.y + offset;

      return dx * dx + dy * dy < limit;
    })
      ? 1
      : 0;
  });
}

measure('sqrt-distance', 1000000, (index) => {
  const dx = ((index & 255) - 128) * 0.013;
  const dy = ((index & 127) - 64) * 0.017;

  return Math.sqrt(dx * dx + dy * dy);
});
measure('hypot-distance', 1000000, (index) => {
  const dx = ((index & 255) - 128) * 0.013;
  const dy = ((index & 127) - 64) * 0.017;

  return Math.hypot(dx, dy);
});
