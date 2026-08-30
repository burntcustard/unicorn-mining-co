import { Vector, directionOf, rotatePoint, rotatePoints } from './vector';
import { colors } from './colors';
import { within } from './polygon';

const fillOf = (ctx, color, from, to, fade) => {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);

  gradient.addColorStop(0, color);
  gradient.addColorStop(fade, color);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

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
const fanning = 0.6;

// How far past the width it started at a sheet is ever allowed to open out.
// However hard a rock bends the light, a beam squeezed to a sliver on its way
// through only has a sliver of light to split, and a rainbow that opened out of
// all proportion to it would be colour coming from nowhere
const spreading = 1.2;

// How nearly two neighbouring rays have to leave a rock going the same way to
// count as one sheet of light. Rays either side of a sharp corner are thrown
// far enough apart to be two sheets heading two ways, and one sheet made of
// both is a beam far wider than the rock ever let through. A gentle corner
// barely turns them at all and is left whole, because splitting that only cuts
// one rainbow into a pair of half ones
const steady = 0.9;

// How much further apart than they went in two neighbouring rays may come out
// and still be one sheet, where they never crossed over on the way through.
// Leaving by a face at a glancing angle spreads them a good way on its own, so
// this is only ever tripped by a beam that has been split outright
const parting = 20;

// Narrower than this and a sheet is a thread a pixel or so across, too thin to
// read as a rainbow and not worth the seven stripes it would be cut into
const thin = 4;

// How square-on a ray has to strike a rock to get into it at all. Light that
// only grazes a face barely gets through one in the first place, and what does
// leaves from somewhere wildly far round the far side, sweeping about as the
// ship drifts, so it is taken as stopping at the face instead
const minFacing = 0.35;

// How many rays are fanned across the cone. Enough that the edge of the light
// lands within a pixel or so of the edge of whatever is casting it
const rays = 64;

// How far along a ray a crossing has to be to count, so that the face a ray is
// setting off from is not found again as the face it runs into
const inset = 1e-4;

// How long a stretch of its end a sheet of light gives out over. A set distance
// rather than a share of its length, so that a stub of a rainbow fades over the
// whole of itself instead of holding solid and then stopping dead
const fades = 200;

// The lit slice inside a rock, as one flat tone rather than a wash. Laid down
// solid it can be drawn over twice and come out the same, so neither the stroke
// closing a seam nor two sheets crossing shows up brighter than the rest of it
const inside = '#555';
const spectrumStrength = 0.9;

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

  if (!entry) return { at: from.add(dir.scale(range)) };

  const into = -dir.dot(entry.normal) >= minFacing &&
    refract(dir, entry.normal, 1 / rockIndex);
  const out = into && cross(hit, entry.at, into);

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
      // Which face it left by, taken as the way that face looks
      face: out.normal.x,
      // Whatever is left of the lamp's reach by the time the rock was reached.
      // Crossing it costs nothing, or a rock far enough off, or thick enough,
      // would swallow the whole of the reach and throw nothing out the far side
      length: range - entry.distance,
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

// Neighbouring rays that went into the same rock and left it as one sheet of
// light. A lone ray is too thin to draw.
//
// Two rays that stepped one way going in and the other way coming out crossed
// over inside the rock, which is what light entering either side of a point
// does, and it leaves as the one sheet however far apart the two halves went.
// Stepping the same way but far further is the opposite: the two never met, and
// the beam has been split in two, as a notch splits it.
//
// Short of that, rays leaving by one face are one sheet. Where they leave by
// two there are two sheets if the corner turned them sharply apart, or if the
// stretch between the ways out lies outside the rock, as it does across the
// mouth of a notch: a sheet spanning that would be seen bridging open space,
// where one spanning unlit rock is covered by the rock itself
const runsOf = ({ rays: fan }) => {
  const runs = [];

  fan.forEach((ray, i) => {
    if (!ray.hit) return;

    const last = fan[i - 1];
    const step = last?.out && ray.out.at.subtract(last.out.at);
    const from = step && ray.at.subtract(last.at);
    const parted = step && step.dot(from) > 0 &&
      step.length() > from.length() * parting;

    if (step && last.hit === ray.hit && !parted &&
      (last.out.face === ray.out.face ||
        (last.out.away.dot(ray.out.away) > steady &&
          within(ray.hit, last.out.at.add(step.scale(0.5)))))) {
      runs[runs.length - 1].push(ray);
    } else {
      runs.push([ray]);
    }
  });

  return runs.filter((run) => run.length > 1);
};

// Square to the way a sheet travels through the rock, which is the line its
// width is measured along
const acrossRun = (run) => {
  const through = run.reduce((sum, ray) =>
    sum.add(ray.out.at.subtract(ray.at)), Vector()).normalize();

  return Vector(-through.y, through.x);
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

  runsOf(beam).forEach((run) => path.addPath(strip(
    run.map(({ at }) => at),
    run.map(({ out }) => out.at),
  )));

  return path;
};

export const drawInside = (ctx, lamp, beam) => {
  const path = insidePath(beam);

  ctx.save();
  ctx.clip(beam.mask);
  ctx.globalCompositeOperation = 'lighten';
  ctx.globalAlpha = lamp.anim;
  ctx.fillStyle = inside;
  ctx.strokeStyle = inside;
  ctx.lineWidth = 1;
  ctx.fill(path);
  // Where one sheet was split from the next they leave a ray's width of a gap
  // between them, too thin to be anything but a black hair, so the same light
  // is run round the edges to close it over
  ctx.stroke(path);
  ctx.restore();
};

/**
 * The rainbow: each sheet of light leaving a rock, cut across its width into as
 * many equal stripes as there are colours. Stripes are laid down side by side
 * and added rather than overlapped, so where two of them meet the half of a
 * pixel each covers adds up to the whole of it, with no bright seam between
 * them and no thread of background showing through either. Sheets crossing one
 * another add up the same way: each is light, and light fades to nothing rather
 * than to a colour, so neither can take anything away from the other.
 */
export const drawSpectrum = (ctx, lamp, beam) => {
  const edges = Array.from({ length: spectrum.length + 1 }, (_, i) => i / spectrum.length);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = lamp.anim * spectrumStrength;

  runsOf(beam).forEach((run) => {
    const away = run.reduce((sum, { out }) => sum.add(out.away), Vector()).normalize();
    const length = run.reduce((sum, { out }) => sum + out.length, 0) / run.length;
    // Rays set off from the lamp itself, so where one went into a rock is also
    // the way it was going, and against where it ended up pointing that says
    // how far round the rock turned it, and which way
    const into = run[run.length >> 1].at.normalize();
    const spin = into.x * away.y - into.y * away.x;
    // The ways out of the first and last of the rays, in the order they were
    // cast, which is the order the slab of light inside the rock is built in.
    // A sheet is then the same width as the beam that is seen to feed it, even
    // where rays crossing over on the way through spread their ways out much
    // further along the face than the beam is thick
    const first = run[0].out.at;
    const span = run[run.length - 1].out.at.subtract(first);
    const side = acrossRun(run);
    // Its sign is which way round the fan has to open for the stripes to spread
    // apart rather than cross over one another
    const width = span.dot(side);

    if (Math.abs(width) < thin) return;

    const sense = width > 0 ? 1 : -1;
    const turn = sense *
      Math.min(fanning * Math.abs(spin), Math.abs(width) * spreading / length);
    const near = edges.map((across) => first.add(span.scale(across)));
    const far = edges.map((across, i) => near[i].add(
      Vector(rotatePoint(away, turn * (across - 0.5))).scale(length)));

    // Squarely down the way the light is going, so a sheet gives out level with
    // the face it came through rather than around one corner of it
    const root = near[spectrum.length >> 1];
    const tip = root.add(away.scale(length));

    // Violet is bent furthest, so it belongs on the side the rock bent towards
    spectrum.forEach((color, band) => {
      ctx.fillStyle = fillOf(ctx,
        spectrum[sense * spin > 0 ? band : spectrum.length - 1 - band], root, tip,
        Math.max(0, 1 - fades / length));
      ctx.fill(strip(near.slice(band, band + 2), far.slice(band, band + 2)));
    });
  });

  ctx.restore();
};
