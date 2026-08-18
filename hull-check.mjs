const inset = 0.5, graze = 0.35, rays = 64;
const midIndex = 1.12, far = 402, spread = 35;
const range = Math.hypot(far, spread), edge = Math.atan2(spread, far);

const crossing = (fx, fy, [ax, ay], [bx, by], dx, dy) => {
  const sx = ax - fx, sy = ay - fy, ex = bx - ax, ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (!denom) return;
  const along = (sx * dy - sy * dx) / denom;
  if (along < 0 || along > 1) return;
  const d = (sx * ey - sy * ex) / denom;
  return d > 0 ? d : undefined;
};
const normalOf = ([ax, ay], [bx, by], dx, dy) => {
  const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
  const x = ey / len, y = -ex / len;
  return dx * x + dy * y > 0 ? [-x, -y] : [x, y];
};
const nearest = (outs, fx, fy, dx, dy) => {
  let near = Infinity, normal;
  outs.forEach((o) => o.forEach((c, i) => {
    const n = o[(i + 1) % o.length];
    const d = crossing(fx, fy, c, n, dx, dy);
    if (!d || d < inset || d >= near) return;
    near = d; normal = normalOf(c, n, dx, dy);
  }));
  return [near, normal];
};
const refract = (dx, dy, [nx, ny], eta) => {
  const facing = -(dx * nx + dy * ny);
  const sideways = eta * eta * (1 - facing * facing);
  const on = Math.sqrt(1 - sideways);
  return { on, ok: on > graze, dir: [eta * dx + (eta * facing - on) * nx, eta * dy + (eta * facing - on) * ny] };
};
const deg = (r) => (r * 180) / Math.PI;

// Apex pointing at the lamp's +x, entered on its two near faces
const tri = [0, 1, 2].map((i) => {
  const a = (i * 2 * Math.PI) / 3;
  return [250 + Math.cos(a) * 70, Math.sin(a) * 70];
});

let hits = 0, inFail = 0, noExit = 0, outFail = 0, ok = 0;

for (let i = 0; i <= rays; i++) {
  const angle = edge * ((i * 2) / rays - 1);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const [near, face] = nearest([tri], 0, 0, dx, dy);
  if (!face || near >= range) continue;
  hits++;

  const into = refract(dx, dy, face, 1 / midIndex);
  if (!into.ok) { inFail++; continue; }

  const [, out] = nearest([tri], dx * near, dy * near, into.dir[0], into.dir[1]);
  if (!out) { noExit++; continue; }

  const away = refract(into.dir[0], into.dir[1], out, midIndex);
  if (!away.ok) {
    outFail++;
    if (outFail < 4) console.log('  ray', i, 'blocked leaving: straightOn', away.on.toFixed(3),
      '=', deg(Math.acos(Math.min(1, away.on))).toFixed(0) + '\u00b0 off the normal');
    continue;
  }
  ok++;
}

console.log('');
console.log('rays that hit the rock :', hits);
console.log('  blocked going in     :', inFail);
console.log('  found no way out     :', noExit);
console.log('  blocked coming out   :', outFail, '<- these are the ones being thrown away');
console.log('  drawn                :', ok);
console.log('');
console.log('graze', graze, 'cuts at', deg(Math.acos(graze)).toFixed(1) + '\u00b0, but real');
console.log('total internal reflection for n =', midIndex, 'is at',
  deg(Math.asin(1 / midIndex)).toFixed(1) + '\u00b0');

console.log('');
console.log('graze | cuts at | rays drawn of 65 | worst step between neighbours');

[0.35, 0.20, 0.12, 0.08, 0.04, 0].forEach((limit) => {
  let drawn = 0, worst = 0, last;

  for (let i = 0; i <= rays; i++) {
    const angle = edge * ((i * 2) / rays - 1);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const [near, face] = nearest([tri], 0, 0, dx, dy);
    if (!face || near >= range) { last = undefined; continue; }

    const into = refract(dx, dy, face, 1 / midIndex);
    if (!(into.on > limit)) { last = undefined; continue; }

    const [, out] = nearest([tri], dx * near, dy * near, into.dir[0], into.dir[1]);
    if (!out) { last = undefined; continue; }

    const away = refract(into.dir[0], into.dir[1], out, midIndex);
    if (!(away.on > limit)) { last = undefined; continue; }

    drawn++;
    const leaves = Math.atan2(away.dir[1], away.dir[0]);
    if (last !== undefined) worst = Math.max(worst, Math.abs(deg(leaves - last)));
    last = leaves;
  }

  console.log(
    String(limit).padStart(5), '|',
    (deg(Math.acos(Math.min(1, limit)))).toFixed(1).padStart(5) + '\u00b0', '|',
    String(drawn).padStart(16), '|', worst.toFixed(2) + '\u00b0',
  );
});

console.log('');
console.log('Split by exit face, as runsOf does:');
console.log('graze | rays drawn | runs | worst step WITHIN a run');

[0.35, 0.20, 0.12, 0.08, 0.04].forEach((limit) => {
  const kept = [];

  for (let i = 0; i <= rays; i++) {
    const angle = edge * ((i * 2) / rays - 1);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const [near, face] = nearest([tri], 0, 0, dx, dy);
    if (!face || near >= range) continue;
    const into = refract(dx, dy, face, 1 / midIndex);
    if (!(into.on > limit)) continue;
    const [, out] = nearest([tri], dx * near, dy * near, into.dir[0], into.dir[1]);
    if (!out) continue;
    const away = refract(into.dir[0], into.dir[1], out, midIndex);
    if (!(away.on > limit)) continue;
    kept.push({ i, face, out, leaves: Math.atan2(away.dir[1], away.dir[0]) });
  }

  const alike = (a, b) => b && a[0] * b[0] + a[1] * b[1] > 0.99;
  let runs = 0, worst = 0, last;

  kept.forEach((ray) => {
    const joins = last && last.i === ray.i - 1 &&
      alike(ray.face, last.face) && alike(ray.out, last.out);
    if (joins) worst = Math.max(worst, Math.abs(deg(ray.leaves - last.leaves)));
    else runs++;
    last = ray;
  });

  console.log(
    String(limit).padStart(5), '|', String(kept.length).padStart(10),
    '|', String(runs).padStart(4), '|', worst.toFixed(2) + '\u00b0',
  );
});
