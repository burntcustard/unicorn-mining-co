/* global process */
// Persistent workers, preloaded geometry and small messages give parallel
// bounds calculation a favorable case. CPU includes both worker threads.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const vertices = Array.from({ length: 8 }, (_, i) => ({
  x: Math.cos(i) * 170,
  y: Math.sin(i) * 170,
}));

function batch(count: number) {
  let result = 0;

  for (let i = 0; i < count; i++) {
    const c = Math.cos(i * 0.01),
      s = Math.sin(i * 0.01);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const v of vertices) {
      const x = c * v.x - s * v.y + i,
        y = s * v.x + c * v.y - i;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    result += minX + maxX + minY + maxY;
  }

  return result;
}

if (!isMainThread) {
  parentPort.on('message', (count) => parentPort.postMessage(batch(count)));
} else {
  const workers = Array.from(
    { length: 2 },
    () => new Worker(new URL(import.meta.url)),
  );

  const run = (worker: Worker, count: number) =>
    new Promise<number>((resolve) => {
      worker.once('message', resolve);
      worker.postMessage(count);
    });

  for (const count of [200, 2000]) {
    for (let i = 0; i < 500; i++) {
      batch(count / 2);
      await Promise.all(workers.map((w) => run(w, count / 2)));
    }

    for (const parallel of [false, true]) {
      let checksum = 0;
      const start = performance.now(),
        cpu = process.cpuUsage();

      for (let i = 0; i < 3000; i++) {
        if (parallel) {
          checksum += (
            await Promise.all(workers.map((w) => run(w, count / 2)))
          ).reduce((s, x) => s + x, 0);
        } else checksum += batch(count / 2) + batch(count / 2);
      }

      const used = process.cpuUsage(cpu);

      console.log(
        JSON.stringify({
          count,
          parallel,
          wallUs: ((performance.now() - start) * 1000) / 3000,
          cpuUs: (used.user + used.system) / 3000,
          checksum,
        }),
      );
    }
  }

  await Promise.all(workers.map((w) => w.terminate()));
}
