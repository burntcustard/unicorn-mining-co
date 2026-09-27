/* global Buffer, process */
// A kernel experiment, not an estimate of full-game performance. All geometry
// is prepacked; Wasm therefore pays no per-query packing or bounds-copy cost.
// Isolate each representation so typed-array polymorphism cannot bias V8.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) {
  for (const variant of ['objects', 'Float64', 'Float32', 'Float16', 'SIMD']) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), variant],
      { stdio: 'inherit' },
    );

    if (child.status !== 0) process.exit(child.status || 1);
  }
  process.exit(0);
}
// Compiled from physics-bounds.wat using wabt; no compiler/runtime dependency
// is added to the game. Regenerate with wat2wasm if the WAT is edited.
const buffer = Buffer.from(
  'AGFzbQEAAAABCwFgBn9/fHx8fAF8AwIBAAUDAQABBxMCBm1lbW9yeQIABmJvdW5kcwAACr4BAbsBAQZ7/QwAAAAAAADwfwAAAAAAAPB/IQb9DAAAAAAAAPD/AAAAAAAA8P8hByAC/RQhCSADmv0UIAP9IgEhCiAE/RQgBf0iASELA0AgAP0ABAAhCCAIIAn98gEgCCAI/Q0ICQoLDA0ODwABAgMEBQYHIAr98gH98AEgC/3wASEIIAYgCP30ASEGIAcgCP31ASEHIABBEGohACABQQFrIQEgAQ0ACyAG/SEAIAf9IQCgIAb9IQEgB/0hAaCgCw==',
  'base64',
);
const {
  instance: { exports: wasm },
} = await WebAssembly.instantiate(buffer);
const poses = Array.from({ length: 1024 }, (_, i) => [
  Math.cos(i / 30),
  Math.sin(i / 30),
  i * 3.31,
  i * -5.2,
]);

for (const count of [8, 24]) {
  const vertices = Array.from({ length: count }, (_, i) => ({
    x: Math.cos((i / count) * 6.28) * 170,
    y: Math.sin((i / count) * 6.28) * 170,
  }));
  const flat = vertices.flatMap((v) => [v.x, v.y]);

  new Float64Array(wasm.memory.buffer).set(flat);
  function objects(c, s, px, py) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (let i = 0; i < count; i++) {
      const v = vertices[i],
        x = c * v.x - s * v.y + px,
        y = s * v.x + c * v.y + py;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return minX + maxX + (minY + maxY);
  }
  const typed = (Type) => {
    const a = Type.from(flat);

    return function (c, s, px, py) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (let i = 0; i < count * 2; i += 2) {
        const x = c * a[i] - s * a[i + 1] + px,
          y = s * a[i] + c * a[i + 1] + py;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return minX + maxX + (minY + maxY);
    };
  };
  const kernels = {
    objects,
    Float64: typed(Float64Array),
    Float32: typed(Float32Array),
    Float16: typed(Float16Array),
    SIMD: (c, s, x, y) => wasm.bounds(0, count, c, s, x, y),
  };

  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [name, fn] of Object.entries(kernels)) {
      if (process.argv[2] && name !== process.argv[2]) continue;
      let checksum = 0;

      for (let i = 0; i < 100000; i++) checksum += fn(...poses[i % 1024]);
      const cpu = process.cpuUsage(),
        start = performance.now();

      for (let i = 0; i < 1000000; i++) checksum += fn(...poses[i % 1024]);
      const used = process.cpuUsage(cpu);

      console.log(
        JSON.stringify({
          count,
          repeat,
          name,
          ns: performance.now() - start,
          cpuNs: (used.user + used.system) / 1000,
          checksum,
        }),
      );
    }
  }
}

for (const x of [20000.1, 20000.2, 70000]) {
  console.log(
    JSON.stringify({
      value: x,
      float16: String(Float16Array.of(x)[0]),
      float32: Float32Array.of(x)[0],
    }),
  );
}
