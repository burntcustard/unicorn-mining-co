/* global process */
// Prepacked arithmetic kernels, not estimates of whole-server CPU savings.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const variants = [
  'float-object',
  'fixed-object',
  'float-packed',
  'fixed-packed',
  'fixed-imul',
];
const kernels = ['advance', 'integrate', 'rotate', 'distance'];

if (!process.argv[2]) {
  for (const kernel of kernels) {
    for (let repeat = 0; repeat < 5; repeat++) {
      const order = repeat % 2 ? [...variants].reverse() : variants;

      for (const variant of order) {
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(import.meta.url), variant, kernel],
          { encoding: 'utf8', timeout: 30000 },
        );

        if (child.status !== 0) throw Error(child.stderr);
        process.stdout.write(child.stdout);
      }
    }
  }
} else {
  const [variant, kernel] = process.argv.slice(2);
  const fixed = variant.startsWith('fixed');
  const packed = variant.endsWith('packed');
  const scale = fixed ? 1000 : 1;
  const trigScale = variant === 'fixed-imul' ? 4096 : fixed ? 1048576 : 1;
  const encode = (value: number) => (fixed ? Math.round(value * scale) : value);
  const trig = (value: number) =>
    fixed ? Math.round(value * trigScale) : value;
  const count = 2048;
  const data = Array.from({ length: count }, (_, i) => [
    encode(Math.sin(i) * 170),
    encode(Math.cos(i) * 170),
    encode((Math.sin(i / 3) * 272) / (kernel === 'advance' ? 30 : 1)),
    encode((Math.cos(i / 3) * 272) / (kernel === 'advance' ? 30 : 1)),
    trig(Math.cos(i / 7)),
    trig(Math.sin(i / 7)),
  ]);
  const values = packed
    ? new (fixed ? Int32Array : Float64Array)(data.flat())
    : data.map(([x, y, vx, vy, c, s]) => ({ x, y, vx, vy, c, s }));
  const access = (name: string) =>
    packed
      ? `a[i*6+${['x', 'y', 'vx', 'vy', 'c', 's'].indexOf(name)}]`
      : `a[i].${name}`;
  const x = access('x'),
    y = access('y'),
    vx = access('vx'),
    vy = access('vy'),
    c = access('c'),
    s = access('s');
  let operation;

  if (kernel === 'integrate' || kernel === 'advance') {
    operation = fixed
      ? `${x} += Math.round(${vx}/30); ${y} += Math.round(${vy}/30);`
      : `${x} += ${vx}/30; ${y} += ${vy}/30;`;

    if (kernel === 'advance') operation = `${x} += ${vx}; ${y} += ${vy};`;
    // Reverse regularly so all fixed-point coordinates remain in Int32 range.
    operation += `if ((r & 31) === 31) { ${vx} = -${vx}; ${vy} = -${vy}; } sum += ${x};`;
  } else if (kernel === 'rotate') {
    operation =
      variant === 'fixed-imul'
        ? `sum += (Math.imul(${c},${x}) - Math.imul(${s},${y})) >> 12;`
        : fixed
          ? `sum += Math.round((${c}*${x}-${s}*${y})/${trigScale});`
          : `sum += ${c}*${x}-${s}*${y};`;
  } else {
    // Local deltas alone already exceed Int32 when squared at scale 1000.
    operation = `const dx=${x}-${vx},dy=${y}-${vy}; sum += dx*dx+dy*dy;`;
  }

  // Each child compiles one monomorphic kernel; no input is executed as code.
  // oxlint-disable-next-line typescript/no-implied-eval
  const run = new Function(
    'a',
    'rounds',
    `let sum=0;for(let r=0;r<rounds;r++)for(let i=0;i<${count};i++){${operation}}return sum;`,
  );

  run(values, 512);
  const cpu = process.cpuUsage(),
    t = performance.now();
  const checksum = run(values, 8192),
    elapsed = performance.now() - t,
    used = process.cpuUsage(cpu);
  let maxRotationError = 0;

  if (kernel === 'rotate') {
    data.forEach(([x, y, , , c, s], i) => {
      const expected =
        Math.cos(i / 7) * Math.sin(i) * 170 -
        Math.sin(i / 7) * Math.cos(i) * 170;
      const actual =
        variant === 'fixed-imul'
          ? ((Math.imul(c, x) - Math.imul(s, y)) >> 12) / scale
          : fixed
            ? Math.round((c * x - s * y) / trigScale) / scale
            : c * x - s * y;

      maxRotationError = Math.max(
        maxRotationError,
        Math.abs(actual - expected),
      );
    });
  }

  console.log(
    JSON.stringify({
      variant,
      kernel,
      maxRotationError,
      cpuMs: (used.user + used.system) / 1000,
      wallMs: elapsed,
      nsPerOperation: (elapsed * 1e6) / (count * 8192),
      checksum,
      packedBytes: 'byteLength' in values ? values.byteLength : null,
    }),
  );
}
