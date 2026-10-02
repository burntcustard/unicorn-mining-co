// Verify the experimental float32 separation arithmetic against Go-generated cases.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const f = Math.fround;
const add = (a, b) => f(a + b);
const sub = (a, b) => f(a - b);
const mul = (a, b) => f(a * b);
let maxDifference = 0;

for (const sample of cases) {
  const { ac, bc, xfA, xfB, limit, index, separation } = sample;
  const a = sample.a.map(f);
  const b = sample.b.map(f);
  const c = f(xfB.Q.C * xfA.Q.C + xfB.Q.S * xfA.Q.S);
  const s = f(xfB.Q.C * xfA.Q.S - xfB.Q.S * xfA.Q.C);
  const x = f(xfB.Q.C * (xfA.P.x - xfB.P.x) + xfB.Q.S * (xfA.P.y - xfB.P.y));
  const y = f(-xfB.Q.S * (xfA.P.x - xfB.P.x) + xfB.Q.C * (xfA.P.y - xfB.P.y));
  const stride = a.length / 4;
  const otherStride = b.length / 4;
  let best = -Infinity;
  let bestIndex = 0;

  for (let i = 0; i < ac; i++) {
    const nx = sub(mul(c, a[2 * stride + i]), mul(s, a[3 * stride + i]));
    const ny = add(mul(s, a[2 * stride + i]), mul(c, a[3 * stride + i]));
    const vx = add(sub(mul(c, a[i]), mul(s, a[stride + i])), x);
    const vy = add(add(mul(s, a[i]), mul(c, a[stride + i])), y);
    const offset = add(mul(nx, vx), mul(ny, vy));
    let minimum = Infinity;

    for (let j = 0; j < bc; j++) {
      const distance = sub(
        add(mul(nx, b[j]), mul(ny, b[otherStride + j])),
        offset,
      );

      if (distance < minimum) minimum = distance;
    }

    if (minimum > limit) {
      bestIndex = i;
      best = minimum;
      break;
    }

    if (minimum > best) {
      bestIndex = i;
      best = minimum;
    }
  }
  assert.equal(bestIndex, index);
  assert.equal(best, separation);
  maxDifference = Math.max(maxDifference, Math.abs(best - separation));
}
console.log(JSON.stringify({ cases: cases.length, maxDifference }));
