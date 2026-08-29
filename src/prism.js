import { Vector, movePoint, rotatePoint, rotatePoints } from './vector';
import { colors } from './colors';

/**
 * What the floodlight does when it runs into rock.
 *
 * The whole thing is one idea repeated: fan a fixed number of rays across the
 * cone, and follow each one until it is done with. A ray either reaches the end
 * of the lamp's reach untouched, or it meets a rock, bends going in, crosses it,
 * and bends again coming out. It is never asked what it meets after that, so
 * light goes through one rock and no further, however many are lined up.
 *
 * Neighbouring rays that went into the same rock make one sheet of light. Where
 * they leave it is taken as one straight line square to the way they are headed,
 * set back far enough that the rock itself covers where the stripes begin, and
 * that line is cut across into equal stripes, one a colour, each thrown out
 * along its own share of a fan opened around the way the sheet was already
 * going. It is a picture of a prism rather than a simulation of one: solid
 * stripes, all the same width, fanning out from one place.
 *
 * A sheet is summed up by what all of its rays agree on rather than by the two
 * on its ends, so a ray joining or leaving one nudges it instead of reshaping
 * it. That, and the rays being always the same rays whatever is in front of the
 * lamp, is what keeps the light steady: nothing is decided by which corners
 * happen to be inside the cone this frame.
 *
 * Everything is worked out in the lamp's own frame, with the lens at zero and
 * the beam running out along positive x.
 */

// The stripes the light splits into, reddest first
const spectrum = [
  colors.red[0],
  colors.orange[0],
  colors.yellow[0],
  colors.green[0],
  colors.cyan[0],
  colors.indigo[0],
  colors.violet[0],
];

// How much rock bends light
const rockIndex = 1.15;

// How wide the stripes fan apart, measured against how far the rock bent the
// light on its way through. A rock that hardly bends it hardly splits it, so
// there is no width to swap ends when which end is the red one changes over
const fanning = 0.5;

// How far past the width it started at a sheet is ever allowed to open out.
// However hard a rock bends the light, a beam squeezed to a sliver on its way
// through only has a sliver of light to split, and a rainbow that opened out of
// all proportion to it would be colour coming from nowhere
const spreading = 2;

// How square-on a ray has to strike a rock to get into it at all. Light that
// only grazes a face barely gets through one in the first place, and what does
// leaves from somewhere wildly far round the far side, sweeping about as the
// ship drifts, so it is taken as stopping at the face instead
const minFacing = 0.35;

// How many rays are fanned across the cone. Enough that the edge of the light
// lands within a pixel or so of the edge of whatever is casting it
const rays = 120;

// How far along a ray a crossing has to be to count, so that the face a ray is
// setting off from is not found again as the face it runs into
const inset = 1e-4;

// How much of a band's length holds full strength before it fades out
const holds = 0.75;

const insideStrength = 0.3;
const spectrumStrength = 0.9;

const directionOf = (angle) => Vector(movePoint(Vector(), angle, 1));

const fillOf = (ctx, color, from, to) => {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);

  gradient.addColorStop(0, color);
  gradient.addColorStop(holds, color);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

/**
 * Where a ray first crosses a polygon: the point, how far along the ray it sits,
 * and the face it landed on, as a normal turned to look back at the ray.
 *
 * @param {Number[][]} points - An outline in the lamp's frame.
 * @param {Object} from - Where the ray starts.
 * @param {Object} dir - Which way it goes, as a unit vector.
 */
const cross = (points, from, dir) => {
  let near = Infinity;
  let normal;

  points.forEach((corner, i) => {
    const next = points[(i + 1) % points.length];
    const edge = Vector(next[0] - corner[0], next[1] - corner[1]);
    const denom = dir.x * edge.y - dir.y * edge.x;
    const start = Vector(corner[0] - from.x, corner[1] - from.y);
    const along = (start.x * dir.y - start.y * dir.x) / denom;
    const distance = (start.x * edge.y - start.y * edge.x) / denom;

    if (!denom || along < 0 || along > 1 || distance < inset || distance >= near) return;

    const face = Vector(edge.y, -edge.x).normalize();

    near = distance;
    normal = dir.dot(face) > 0 ? face.scale(-1) : face;
  });

  return normal && { at: from.add(dir.scale(near)), distance: near, normal };
};

/**
 * Snell's law. A ray that would be trapped inside instead leaves along the face
 * it hit, which keeps a band that is on the edge of being trapped from blinking
 * out of existence as the ship drifts.
 *
 * @param {Object} dir - Which way the light is going.
 * @param {Object} normal - The face it is crossing, facing back at it.
 * @param {Number} index - How much the material it is entering slows it down.
 */
const refract = (dir, normal, index) => {
  const facing = -dir.dot(normal);
  // Both roots are held to what they can really be, because a ray meeting a
  // face square on, or one right on the edge of being trapped, comes out a hair
  // the wrong side of that and the root of it is not a number
  const square = Math.max(0, 1 - facing * facing);
  const eta = Math.min(index, 1 / Math.sqrt(square));
  const sideways = Math.min(1, eta * eta * square);

  return dir.scale(eta).add(normal.scale(eta * facing - Math.sqrt(1 - sideways)));
};

// One scenery object's shape in the lamp's frame, added to the mask as a path
// and handed back as points for the rays to be tested against
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

/**
 * One ray, all the way through. Where it stops is where the light stops, and
 * what it found on the way is everything the rainbow needs.
 */
const rayAt = (outlines, angle, range) => {
  const dir = directionOf(angle);
  const from = Vector();
  let entry;
  let hit;

  outlines.forEach((outline) => {
    const found = cross(outline, from, dir);

    if (found && found.distance < range && (!entry || found.distance < entry.distance)) {
      entry = found;
      hit = outline;
    }
  });

  if (!entry || -dir.dot(entry.normal) < minFacing) {
    return { at: entry ? entry.at : from.add(dir.scale(range)) };
  }

  const into = refract(dir, entry.normal, 1 / rockIndex);
  const out = cross(hit, entry.at, into);

  if (!out) return { at: entry.at };

  const away = refract(into, out.normal, rockIndex);

  return {
    at: entry.at,
    // Only ever the rock this ray went into, so light that comes out the far
    // side carries on into open space rather than through whatever is behind
    hit,
    out: {
      at: out.at,
      away,
      // Whatever is left of the lamp's reach by the time the rock was reached.
      // Crossing it costs nothing, or a rock far enough off, or thick enough,
      // would swallow the whole of the reach and throw nothing out the far side
      length: range - entry.distance,
      // How far round the rock turned the light, and which way
      spin: dir.x * away.y - dir.y * away.x,
    },
  };
};

/**
 * Follow the whole cone. Everything drawn afterwards reads this and works
 * nothing out for itself.
 *
 * @param {Object} ship - Whatever is carrying the lamp.
 * @param {Object} lamp - The lit segment, mounted at `x`, `y` on the ship.
 * @param {Object[]} scenery - Anything that might be in the way.
 */
export const traceBeam = (ship, lamp, scenery) => {
  const { lens, reach, spread } = lamp.module;
  const range = Math.hypot(lens + reach, spread);
  const edge = Math.atan2(spread, lens + reach);
  const mask = new Path2D();
  const outlines = scenery.filter((object) => object.outline &&
    object.position.distance(ship.position) - object.radius < range)
    .map((object) => outlineOf(ship, lamp, object, mask));

  return {
    mask,
    outlines,
    range,
    rays: Array.from({ length: rays + 1 }, (_, i) =>
      rayAt(outlines, edge * (i * 2 / rays - 1), range)),
  };
};

// A sheet with one edge running out along one line of points and back along
// another
const strip = (near, far) => {
  const path = new Path2D();

  near.forEach(({ x, y }, i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
  for (let i = far.length; i--;) path.lineTo(far[i].x, far[i].y);
  path.closePath();

  return path;
};

// Neighbouring rays that went into the same rock and out the other side. One
// run is one sheet of light crossing it, and a single ray is too thin to draw
const runsOf = ({ rays: fan }) => {
  const runs = [];

  fan.forEach((ray, i) => {
    const run = runs[runs.length - 1];

    if (!ray.hit) return;

    if (run && run.hit === ray.hit && run.to === i - 1) {
      run.rays.push(ray);
      run.to = i;
    } else {
      runs.push({ hit: ray.hit, rays: [ray], to: i });
    }
  });

  return runs.filter((run) => run.rays.length > 1);
};

// How far the light got, as the fan of everywhere its rays stopped
export const litPath = ({ rays: fan }) => {
  const path = new Path2D();

  path.moveTo(0, 0);
  fan.forEach(({ at }) => path.lineTo(at.x, at.y));
  path.closePath();

  return path;
};

// The slice of rock the light is actually crossing, from where it went in to
// where it came out again
export const insidePath = (beam) => {
  const path = new Path2D();

  runsOf(beam).forEach(({ rays: run }) => path.addPath(strip(
    run.map(({ at }) => at),
    run.map(({ out }) => out.at),
  )));

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

/**
 * The rainbow: each sheet of light leaving a rock, cut across its width into as
 * many equal stripes as there are colours. Stripes are laid down side by side
 * and added rather than overlapped, so where two of them meet the half of a
 * pixel each covers adds up to the whole of it, with no bright seam between
 * them and no thread of background showing through either.
 *
 * Where two whole sheets cross, though, the second is kept out of the first
 * rather than piled onto it: a rock splits the light it is given and cannot
 * hand back more than it got, so a crossing never comes out whiter than white.
 */
export const drawSpectrum = (ctx, lamp, beam) => {
  const covered = new Path2D();
  const edges = Array.from({ length: spectrum.length + 1 }, (_, i) => i / spectrum.length);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = lamp.anim * spectrumStrength;

  runsOf(beam).forEach(({ rays: run }) => {
    const share = 1 / run.length;
    const away = run.reduce((sum, { out }) => sum.add(out.away), Vector()).normalize();
    const spin = run.reduce((sum, { out }) => sum + out.spin, 0) * share;
    const length = run.reduce((sum, { out }) => sum + out.length, 0) * share;
    // The stripes start on exactly the line the beam inside the rock ends on,
    // so the two are the same width and meet at the face rather than one
    // flaring out of the side of the other
    const first = run[0].out.at;
    const span = run[run.length - 1].out.at.subtract(first);
    // Which way round the fan has to open for its stripes to spread apart
    // rather than cross over one another
    const sense = away.x * span.y - away.y * span.x > 0 ? 1 : -1;
    const turn = sense *
      Math.min(fanning * Math.abs(spin), span.length() * spreading / length);
    const near = edges.map((across) => first.add(span.scale(across)));
    const far = edges.map((across, i) => near[i].add(
      Vector(rotatePoint(away, turn * (across - 0.5))).scale(length)));
    // Squarely down the way the light is going, so a sheet gives out level with
    // the face it came through rather than around one corner of it
    const root = first.add(span.scale(0.5));
    const tip = root.add(away.scale(length));
    const sheet = strip(near, far);
    const room = new Path2D();

    room.addPath(sheet);
    room.addPath(covered);
    ctx.save();
    ctx.clip(room, 'evenodd');
    // Violet is bent furthest, so it belongs on the side the rock bent towards
    spectrum.forEach((color, band) => {
      ctx.fillStyle = fillOf(ctx,
        spectrum[sense * spin > 0 ? band : spectrum.length - 1 - band], root, tip);
      ctx.fill(strip(near.slice(band, band + 2), far.slice(band, band + 2)));
    });
    ctx.restore();
    covered.addPath(sheet);
  });

  ctx.restore();
};
