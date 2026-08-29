import { Vector, movePoint, pointBetween, rotatePoints } from './vector';
import { colors } from './colors';
import { game } from './game';

const spectrum = [
  colors.red[0],
  colors.orange[0],
  colors.yellow[0],
  colors.green[0],
  colors.cyan[0],
  colors.indigo[0],
  colors.violet[0],
];

const redIndex = 1.1;
const violetIndex = 1.2;
const midIndex = (redIndex + violetIndex) / 2;
const inset = 0.5;
const insideStrength = 0.3;
const spectrumStrength = 0.9;
const seam = 0.4;
const minimumBeamWidth = 3;
const holds = 0.75;

const fillOf = (ctx, color, range) => {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, range);

  gradient.addColorStop(0, color);
  gradient.addColorStop(holds, color);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

const directionOf = (angle) => movePoint(Vector(), angle, 1);

const crossing = (fromX, fromY, [ax, ay], [bx, by], dirX, dirY) => {
  const startX = ax - fromX;
  const startY = ay - fromY;
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const denom = dirX * edgeY - dirY * edgeX;

  if (!denom) return;

  const along = (startX * dirY - startY * dirX) / denom;

  if (along < -1e-9 || along > 1 + 1e-9) return;

  const distance = (startX * edgeY - startY * edgeX) / denom;

  return distance > 0 && distance;
};

// Nearest already-ordered outer edge, its index, and the normal facing the ray.
const nearest = (outlines, fromX, fromY, dirX, dirY) => {
  let near = Infinity;
  let shape;
  let edge;
  let normal;

  outlines.forEach((outline) => outline.forEach((corner, i) => {
    const next = outline[(i + 1) % outline.length];
    const distance = crossing(fromX, fromY, corner, next, dirX, dirY);

    if (!distance || distance < inset || distance >= near) return;

    const edgeX = next[0] - corner[0];
    const edgeY = next[1] - corner[1];
    const length = Math.hypot(edgeX, edgeY);
    const x = edgeY / length;
    const y = -edgeX / length;

    near = distance;
    shape = outline;
    edge = i;
    normal = dirX * x + dirY * y > 0 ? [-x, -y] : [x, y];
  }));

  return [near, shape, edge, normal];
};

const refract = (dirX, dirY, [normalX, normalY], eta) => {
  const facing = -(dirX * normalX + dirY * normalY);

  eta = Math.min(eta, 1 / Math.sqrt(1 - facing * facing));
  const sideways = eta * eta * (1 - facing * facing);
  const turn = eta * facing - Math.sqrt(1 - sideways);

  return [eta * dirX + turn * normalX, eta * dirY + turn * normalY];
};

const outlineOf = (ship, lamp, object, mask) => {
  const shipCos = Math.cos(ship.rotation);
  const shipSin = Math.sin(ship.rotation);
  const awayX = object.x - ship.x;
  const awayY = object.y - ship.y;
  const middleX = awayX * shipCos + awayY * shipSin - lamp.x;
  const middleY = awayY * shipCos - awayX * shipSin - lamp.y;

  const turn = object.rotation - ship.rotation;

  mask.addPath(object.path, new DOMMatrix().translate(middleX, middleY)
    .rotate(turn * 180 / Math.PI));

  return rotatePoints(object.outline, turn, middleX, middleY);
};

// One ray through one outline. The same answer supplies its internal endpoint,
// rainbow origin, outgoing direction, and the two outer-edge indexes.
const through = (outline, enterX, enterY, dirX, dirY, face, index, range) => {
  const [intoX, intoY] = refract(dirX, dirY, face, 1 / index);
  const [depth,, edge, out] = nearest([outline], enterX, enterY, intoX, intoY);
  const across = Math.min(depth, range);
  const away = out && refract(intoX, intoY, out, index);

  return [enterX + intoX * across, enterY + intoY * across,
    away, across, edge, out];
};

export const traceBeam = (ship, lamp, scenery) => {
  const { lens, reach, spread } = lamp.module;
  const far = lens + reach;
  const range = Math.hypot(far, spread);
  const edge = Math.atan2(spread, far);
  const mask = new Path2D();
  const outlines = scenery.filter((object) => object.outline &&
    object.position.distance(ship.position) - object.radius < range)
    .map((object) => outlineOf(ship, lamp, object, mask));
  const angles = [...new Set([-edge, edge, ...outlines.flatMap((outline) =>
    outline.map(([x, y]) => Math.atan2(y, x))
      .filter((angle) => angle > -edge && angle < edge))])].sort((a, b) => a - b);
  const cuts = angles.map((angle) => {
    const { x, y } = directionOf(angle);

    return Math.min(nearest(outlines, 0, 0, x, y)[0], range);
  });
  const spans = angles.slice(1).map((to, i) => {
    const angle = (angles[i] + to) / 2;
    const { x, y } = directionOf(angle);
    const [near, outline, entry, face] = nearest(outlines, 0, 0, x, y);
    const passed = near < range && through(outline, x * near, y * near,
      x, y, face, midIndex, range);

    return {
      angle,
      entry,
      exit: passed && passed[4],
      face: passed && face,
      from: i,
      leave: passed && passed[2] && passed[5],
      outline,
      out: passed && Math.max(0, range - near - passed[3]),
      to: i + 1,
    };
  });

  return { angles, cuts, mask, outlines, range, spans };
};

const line = (path, angle, distance) => {
  const point = movePoint(Vector(), angle, distance);

  path.lineTo(point.x, point.y);
};

export const litPath = ({ angles, cuts, range, spans }) => {
  const path = new Path2D();
  const edges = spans.map((span) => span.face ?
      [cuts[span.from], cuts[span.to]] :
      [range, range]);

  for (let from = 0; from < spans.length;) {
    if (spans[from].face) {
      from++;
      continue;
    }

    let to = from + 1;

    while (to < spans.length && !spans[to].face) to++;

    const left = spans[from - 1]?.face && cuts[from];
    const right = spans[to]?.face && cuts[to];
    const stop = Math.min(left || range, right || range);

    if ((left || right) && (angles[to] - angles[from]) * stop * game.scale < minimumBeamWidth) {
      const first = left || right;
      const last = right || left;
      const depth = (at) => first + (last - first) * (at - from) / (to - from);

      for (let i = from; i < to; i++) edges[i] = [depth(i), depth(i + 1)];
    }

    from = to;
  }

  path.moveTo(0, 0);
  line(path, angles[0], edges[0][0]);
  spans.forEach((span, i) => {
    line(path, angles[i + 1], edges[i][1]);
    if (spans[i + 1]) line(path, angles[i + 1], edges[i + 1][0]);
  });
  path.closePath();

  return path;
};

const runsOf = ({ spans }, inside) => {
  const runs = [];

  spans.forEach((span, i) => {
    if (!span.face || (!inside && !span.leave)) return;

    const last = runs[runs.length - 1];
    const previous = spans[i - 1];

    if (last && last.to === i && span.outline === previous.outline &&
      span.entry === previous.entry && span.exit === previous.exit) {
      last.to++;
    } else {
      runs.push({ from: i, to: i + 1 });
    }
  });

  return runs;
};

const between = (near, far) => {
  const path = new Path2D();

  near.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
  for (let i = far.length; i--;) path.lineTo(far[i][0], far[i][1]);
  path.closePath();

  return path;
};

const throughAt = (beam, run, boundary) => {
  const span = beam.spans[run.from];
  const angle = beam.angles[boundary];
  const { x, y } = directionOf(angle);
  const from = span.outline[span.entry];
  const to = span.outline[(span.entry + 1) % span.outline.length];
  const distance = crossing(0, 0, from, to, x, y);
  const enter = [x * distance, y * distance];
  const passed = through(span.outline, enter[0], enter[1], x, y,
    span.face, midIndex, beam.range);

  return [enter, passed.slice(0, 2), ...passed.slice(2)];
};

export const insidePath = (beam) => {
  const path = new Path2D();

  runsOf(beam, true).forEach((run) => {
    const ends = [run.from, run.to].map((boundary) => throughAt(beam, run, boundary));

    ends.forEach((end) => end[1] = pointBetween(end[0], end[1], beam.range / end[3]));
    path.addPath(between(ends.map((end) => end[0]), ends.map((end) => end[1])));
  });

  return path;
};

export const drawInside = (ctx, lamp, beam) => {
  ctx.save();
  ctx.clip(beam.mask);
  ctx.globalCompositeOperation = 'lighten';
  ctx.globalAlpha = lamp.anim * insideStrength;
  ctx.fillStyle = lamp.shades[2];
  ctx.fill(insidePath(beam));
  ctx.restore();
};

export const drawSpectrum = (ctx, lamp, beam) => {
  ctx.save();
  ctx.globalCompositeOperation = 'lighten';
  ctx.globalAlpha = lamp.anim * spectrumStrength;

  runsOf(beam).forEach((run) => {
    const middle = beam.spans[Math.floor((run.from + run.to - 1) / 2)];
    const direction = directionOf(middle.angle);
    const passed = [run.from, run.to].map((boundary) => throughAt(beam, run, boundary));

    if (passed.some((end) => end[4] === undefined)) return;

    const ends = passed.map((end) => end[1]);
    const span = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);

    if (span < spectrum.length * minimumBeamWidth / game.scale) return;

    const [red, violet] = [redIndex, violetIndex].map((index) => {
      const into = refract(direction.x, direction.y, middle.face, 1 / index);

      return refract(into[0], into[1], middle.leave, index);
    });
    const out = middle.out;
    const sideX = ends[1][0] - ends[0][0];
    const sideY = ends[1][1] - ends[0][1];
    const way = (violet[0] - red[0]) * sideX + (violet[1] - red[1]) * sideY > 0;

    spectrum.forEach((color, band) => {
      const from = band / spectrum.length;
      const to = Math.min(1, (band + 1) / spectrum.length + seam / span);
      const near = [pointBetween(ends[0], ends[1], from),
        pointBetween(ends[0], ends[1], to)];
      const far = near.map((point, i) => pointBetween(way ? red : violet,
        way ? violet : red, i ? to : from)
        .map((axis, coordinate) => point[coordinate] + axis * out));

      ctx.fillStyle = fillOf(ctx,
        way ? color : spectrum[spectrum.length - band - 1], beam.range);
      ctx.fill(between(near, far));
    });
  });

  ctx.restore();
};
