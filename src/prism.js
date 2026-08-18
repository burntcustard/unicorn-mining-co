/**
 * What a lamp's beam runs into, and what comes back out the other side of it.
 *
 * The beam is taken apart into a fan of rays and each one is followed until it
 * hits something, which is what stops the light on the real outline of a rock
 * rather than on the circle drawn round it. Every ray that was stopped is then
 * bent through the rock the way it would really be bent: turned towards the
 * face it went in by, followed across to whichever face it reaches next, and
 * turned again on the way back out.
 *
 * How far it turns depends on how much the rock slows it down, and a rock
 * slows violet more than it slows red. That one difference is the whole of why
 * a beam comes out the far side as a spectrum, and doing it this way means the
 * colours lean whichever way the faces they met actually point rather than
 * always the same way.
 *
 * All of it is worked out in the lamp's own frame, where the lamp sits at the
 * origin and shines along positive x, which is how the cone is drawn too.
 */
import { colors } from './colors';

// The colours light comes apart into, in the order it comes apart in
const spectrum = ['red', 'orange', 'yellow', 'green', 'cyan', 'indigo', 'violet'];

// How many rays the beam is taken apart into. Fine enough that the edge of a
// rock reads as an edge rather than as a staircase, coarse enough to be cheap
const rays = 64;

// How much a rock slows the light down, least for red and most for violet.
// Glass is nearer one and a half, and the gap between its two ends is nearer a
// fiftieth than a twentieth: a real spectrum takes a room to come apart, so
// this is left exaggerated, but only about fourfold rather than eightfold
const redIndex = 1.09;
const violetIndex = 1.15;
const midIndex = (redIndex + violetIndex) / 2;

// How far past a face a ray has to get before it is allowed to hit another, so
// that the one it just came through is not found all over again
const inset = 0.5;

// How squarely two rays have to agree about which way the face they went into
// was pointing to count as having gone into the same one
const sameFace = 0.99;

// How square on to a face the light has to leave it. At ninety degrees none of
// it gets out at all, and this stops just short of that, where the angle it
// comes out at starts swinging wildly for the smallest change. Any further
// back and it starts throwing away light that would really get through
const graze = 0.08;

// How far each colour laps over the next, in rays. Two fills sharing an exact
// edge leave a hairline of background showing between them
const seam = 0.5;

// How far apart red and violet have to leave, as a sine, before the fan is
// sure enough of itself to be allowed to change which way round it goes. Two
// faces near enough parallel make a slab rather than a prism, and a slab has
// no opinion at all: the answer is noise, and following it means flipping the
// spectrum end for end from one frame to the next
const decisive = 0.02;

// How many pairs of faces are kept in mind at once
const recalls = 8;

// How brightly the light shows on its way through a rock, and how brightly the
// colours show once they are back out of it. Both have the beam's own light
// stopped short of them, so they are laid onto the dark and can be strong
const insideStrength = 0.3;
const spectrumStrength = 0.85;

// How far out a colour holds before it starts giving out. The light is only
// split some way down the beam to begin with, so a fade that starts at the
// lamp has half gone by the time there is anything to fade
const holds = 0.75;

const fills = {};

const fillOf = (ctx, color, range) => {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, range);

  gradient.addColorStop(0, color);
  gradient.addColorStop(holds, color);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

// Rings on the lamp, so one gradient serves a colour however the ship is
// pointing and wherever round the cone the band it fills happens to sit
const fillFor = (ctx, color, range) => (fills[color] ||= fillOf(ctx, color, range));

/**
 * How far along a ray it crosses an edge, or nothing if it never does. Both
 * answers come out of the same pair of cross products, which is what makes
 * this cheap enough to run thousands of times a frame.
 */
const crossing = (fromX, fromY, [ax, ay], [bx, by], dirX, dirY) => {
  const startX = ax - fromX;
  const startY = ay - fromY;
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const denom = dirX * edgeY - dirY * edgeX;

  if (!denom) return;

  // Whereabouts along the edge the crossing sits. Off either end of it and the
  // ray went past the edge rather than through it
  const along = (startX * dirY - startY * dirX) / denom;

  if (along < 0 || along > 1) return;

  const distance = (startX * edgeY - startY * edgeX) / denom;

  return distance > 0 ? distance : undefined;
};

// Which way a face points, taken facing back against whatever is arriving at
// it, because that is the way round refraction wants it
const normalOf = ([ax, ay], [bx, by], dirX, dirY) => {
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const length = Math.hypot(edgeX, edgeY);
  const x = edgeY / length;
  const y = -edgeX / length;

  return dirX * x + dirY * y > 0 ? [-x, -y] : [x, y];
};

// The first face a ray meets, and which way it points
const nearest = (outlines, fromX, fromY, dirX, dirY) => {
  let near = Infinity;
  let normal;

  outlines.forEach((outline) => {
    outline.forEach((corner, i) => {
      const next = outline[(i + 1) % outline.length];
      const distance = crossing(fromX, fromY, corner, next, dirX, dirY);

      if (!distance || distance < inset || distance >= near) return;

      near = distance;
      normal = normalOf(corner, next, dirX, dirY);
    });
  });

  return [near, normal];
};

/**
 * Snell's law, in two dimensions, or nothing at all if the light cannot get
 * across. `eta` is how much it speeds up as it crosses.
 */
const refract = (dirX, dirY, [normalX, normalY], eta) => {
  const facing = -(dirX * normalX + dirY * normalY);
  const sideways = eta * eta * (1 - facing * facing);
  const straightOn = Math.sqrt(1 - sideways);

  // Written this way round so that a sideways of more than one, which leaves
  // no root to take, falls out here rather than carrying on as a NaN
  if (!(straightOn > graze)) return;

  const turn = eta * facing - straightOn;

  return [eta * dirX + turn * normalX, eta * dirY + turn * normalY];
};

/**
 * A rock's outline where the lamp sees it: turned out of the rock's own frame,
 * into the world, and back into the ship's.
 */
const outlineOf = (ship, lamp, thing) => {
  const shipCos = Math.cos(ship.rotation);
  const shipSin = Math.sin(ship.rotation);
  const awayX = (thing.x - ship.x) / ship.scale;
  const awayY = (thing.y - ship.y) / ship.scale;
  const turn = thing.rotation - ship.rotation;
  const turnCos = Math.cos(turn);
  const turnSin = Math.sin(turn);
  const middleX = awayX * shipCos + awayY * shipSin - lamp.x;
  const middleY = awayY * shipCos - awayX * shipSin - lamp.y;

  return thing.outline.map(([x, y]) => [
    middleX + (x * turnCos - y * turnSin) / ship.scale,
    middleY + (x * turnSin + y * turnCos) / ship.scale,
  ]);
};

/**
 * A ray put right through a rock: turned as it goes in, followed across to
 * whichever face it meets next, and turned again on the way back out. Nothing
 * at all only if it could not get in.
 *
 * @returns {Array} [passed] - Where it came out, which way it left if it left
 *   at all, how far it had to go, and the face it reached.
 */
const through = (outlines, enterX, enterY, dirX, dirY, face, index, range) => {
  const into = refract(dirX, dirY, face, 1 / index);

  if (!into) return;

  const [intoX, intoY] = into;
  const [depth, out] = nearest(outlines, enterX, enterY, intoX, intoY);
  const across = Math.min(depth, range);
  // Light that cannot get back out still crossed the rock to find that out, so
  // where it got to is worth having even when nothing comes of it
  const away = out && refract(intoX, intoY, out, index);

  return [enterX + intoX * across, enterY + intoY * across, away, across, out];
};

/**
 * Follow every ray of the beam until it hits something.
 *
 * @param {Object} ship - Whoever is holding the lamp.
 * @param {Object} lamp - The segment the beam is drawn as.
 * @param {Object[]} scenery - Anything that can stand in the light.
 * @returns {Object} beam - Which way each ray went, how far it got, and which
 *   way the faces it went in and back out by were pointing.
 */
export const traceBeam = (ship, lamp, scenery) => {
  const { lens, reach, spread } = lamp.module;
  const far = lens + reach;
  // Out to the corners of the cone rather than to the reach, or the fan would
  // fall short of them and cut the beam's own far edge off
  const range = Math.hypot(far, spread);
  const edge = Math.atan2(spread, far);
  const outlines = scenery
    .filter(({ outline, radius, x, y }) => outline &&
      Math.hypot(x - ship.x, y - ship.y) / ship.scale - radius < range)
    .map((thing) => outlineOf(ship, lamp, thing));
  const beam = { angles: [], faces: [], hit: [], leaves: [], outlines, range };

  for (let i = 0; i <= rays; i++) {
    const angle = edge * ((i * 2) / rays - 1);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const [near, face] = nearest(outlines, 0, 0, dirX, dirY);
    const stopped = near < range && face;
    // Which face it comes back out by matters as much as the one it went in
    // by, and it is only worth knowing to the nearest colour, so the middle of
    // the spectrum stands in for all of them
    const passed = stopped &&
      through(outlines, dirX * near, dirY * near, dirX, dirY, face, midIndex, range);

    beam.angles.push(angle);
    beam.hit.push(Math.min(near, range));
    beam.faces.push(passed ? face : undefined);
    beam.leaves.push(passed && passed[2] && passed[4]);
  }

  return beam;
};

/**
 * The shape the light actually reaches, which is the fan of rays cut short
 * wherever one of them ran into something.
 *
 * @param {Object} beam
 * @returns {Path2D} lit
 */
export const litPath = ({ angles, hit }) => {
  const path = new Path2D();

  path.moveTo(0, 0);
  angles.forEach((angle, i) => path.lineTo(Math.cos(angle) * hit[i], Math.sin(angle) * hit[i]));
  path.closePath();

  return path;
};

const alike = (now, before) => before && now[0] * before[0] + now[1] * before[1] > sameFace;

// Runs of rays that went in by the same face, whether or not any of the light
// found its way back out again. Trapped light still crosses the rock, and the
// crossing is worth seeing even when nothing comes out the far side
const crossings = ({ faces }) => {
  const runs = [];

  faces.forEach((face, i) => {
    if (!face) return;

    const last = runs[runs.length - 1];

    if (last && last.to === i - 1 && alike(face, faces[i - 1])) last.to = i;
    else runs.push({ from: i, to: i });
  });

  return runs;
};

// Runs that also came back out by the same face, each of which is one clean
// pass through a prism. Light across a corner meets faces pointing quite
// different ways and is bent quite differently by each, so it comes out as two
// rainbows rather than as one smeared between them
const runsOf = ({ faces, leaves }) => {
  const runs = [];

  faces.forEach((face, i) => {
    // A ray with no way out has no colours to give. Left in, it brings a wild
    // angle of its own to whichever band it lands in
    if (!face || !leaves[i]) return;

    const last = runs[runs.length - 1];
    const same = alike(face, faces[i - 1]) && alike(leaves[i], leaves[i - 1]);

    if (last && last.to === i - 1 && same) last.to = i;
    else runs.push({ from: i, to: i });
  });

  return runs;
};

// The shape swept between two rows of points, walked out along one of them and
// back along the other
const between = (near, far) => {
  const path = new Path2D();

  near.forEach(([x, y], i) => {
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  });

  for (let i = far.length - 1; i >= 0; i--) path.lineTo(far[i][0], far[i][1]);

  path.closePath();

  return path;
};

// A point part way between two of a row, so that a band can start and stop
// wherever its share of the face actually falls
const partWay = (points, where) => {
  const first = Math.min(Math.floor(where), points.length - 2);
  const rest = where - first;
  const [ax, ay] = points[first];
  const [bx, by] = points[first + 1];

  return [ax + (bx - ax) * rest, ay + (by - ay) * rest];
};

// The stretch of a row between two places along it, both ends included
const stretch = (points, from, to) => {
  const part = [partWay(points, from)];

  for (let i = Math.ceil(from); i < to; i++) part.push(points[i]);

  part.push(partWay(points, to));

  return part;
};

/**
 * Which way a colour leaves, put through one named pair of faces rather than
 * through whatever it happens to run into. Letting it find its own way out is
 * what breaks this: red and violet take slightly different paths inside a rock
 * and near a corner they leave by different faces, so their two answers stop
 * being comparable and whatever is worked out from them flips about.
 */
const leaving = (dirX, dirY, entry, exit, index) => {
  const into = refract(dirX, dirY, entry, 1 / index);

  return (into && refract(into[0], into[1], exit, index)) || into;
};

/**
 * Which way round a pair of faces sent the colours last time. A run is not the
 * same object from one frame to the next, so it is looked up by the faces it
 * went in and back out by rather than by anything about the run itself.
 */
const recall = (ways, entry, exit) => ways.find(([was, out]) =>
  was[0] * entry[0] + was[1] * entry[1] > sameFace &&
  out[0] * exit[0] + out[1] * exit[1] > sameFace);

/**
 * @param {CanvasRenderingContext2D} ctx - Already at the lamp, facing its way.
 * @param {Object} lamp - The segment the beam is drawn as.
 * @param {Object} beam
 */
export const drawSpectrum = (ctx, lamp, beam) => {
  const { angles, faces, hit, leaves, outlines, range } = beam;
  const runs = runsOf(beam);
  const ways = lamp.ways ||= [];

  ctx.save();

  // Everything that got into a rock, drawn crossing it, whether or not any of
  // it gets out the far side
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = lamp.anim * insideStrength;
  ctx.fillStyle = lamp.shades[2];

  crossings(beam).forEach((run) => {
    const entries = [];
    const exits = [];

    for (let i = run.from; i <= run.to; i++) {
      const dirX = Math.cos(angles[i]);
      const dirY = Math.sin(angles[i]);
      const enterX = dirX * hit[i];
      const enterY = dirY * hit[i];
      const [leaveX, leaveY] =
        through(outlines, enterX, enterY, dirX, dirY, faces[i], midIndex, range);

      entries.push([enterX, enterY]);
      exits.push([leaveX, leaveY]);
    }

    if (entries.length > 1) ctx.fill(between(entries, exits));
  });

  runs.forEach((run) => {
    // A single ray of a run is a graze off a corner, and has no width to make
    // a rainbow out of
    if (run.to === run.from) return;

    const span = run.to - run.from;
    // Which way round the colours go: red and violet put through the run's own
    // pair of faces, and whichever side of red violet comes out is the way the
    // fan opens. How far to one side is how sure of that it is, and where it is
    // not sure the last answer worth having is kept rather than a fresh guess
    const middle = Math.round((run.from + run.to) / 2);
    const midX = Math.cos(angles[middle]);
    const midY = Math.sin(angles[middle]);
    const red = leaving(midX, midY, faces[middle], leaves[middle], redIndex);
    const violet = leaving(midX, midY, faces[middle], leaves[middle], violetIndex);
    const apart = red[0] * violet[1] - red[1] * violet[0];
    const held = recall(ways, faces[middle], leaves[middle]);
    const way = !held || Math.abs(apart) > decisive ? apart >= 0 : held[2];

    // Kept against the faces as they are now, so that a slowly turning rock
    // carries its answer along with it rather than losing it and starting again
    if (held) [held[0], held[1], held[2]] = [faces[middle], leaves[middle], way];
    else ways.unshift([faces[middle], leaves[middle], way]);

    ways.length = Math.min(ways.length, recalls);

    const exits = [];
    const aways = [];

    for (let i = run.from; i <= run.to; i++) {
      const dirX = Math.cos(angles[i]);
      const dirY = Math.sin(angles[i]);
      const enterX = dirX * hit[i];
      const enterY = dirY * hit[i];
      // Red at the end of the face the light leans away from and violet at the
      // other, run together in between, so the colours come apart into one fan
      // with no gaps in it whichever way round the face is
      const along = (i - run.from) / span;
      const index = redIndex + (violetIndex - redIndex) * (way ? along : 1 - along);
      const passed = through(outlines, enterX, enterY, dirX, dirY, faces[i], index, range);
      // Every ray of a run gets out at the middle of the spectrum, which is
      // what put it there, so that stands in for the odd colour that does not
      const [leaveX, leaveY, away, across] = passed[2] ?
        passed :
          through(outlines, enterX, enterY, dirX, dirY, faces[i], midIndex, range);
      const out = Math.max(0, range - hit[i] - across);

      exits.push([leaveX, leaveY]);
      aways.push([leaveX + away[0] * out, leaveY + away[1] * out]);
    }

    // Taken as the brighter of the colour and whatever is already there rather
    // than added onto it, because a corner throws two fans across each other
    // and adding those would have more light leaving the rock than went in
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = lamp.anim * spectrumStrength;

    spectrum.forEach((name, band) => {
      // A share of the face the light came out of, rather than the whole of
      // it, so the colours leave side by side the way they do off a prism.
      // Taken as an exact share rather than to the nearest ray, or a band gains
      // and loses a whole ray's worth of width as the ship drifts about
      const from = (band * span) / spectrum.length;
      const to = Math.min(span, ((band + 1) * span) / spectrum.length + seam);

      // Taken from whichever end of the fan bends least, so red always sits on
      // the inside of the bend rather than swapping sides with the face
      const color = way ? name : spectrum[spectrum.length - 1 - band];

      // The deepest shade of each, because light is added to whatever is
      // already there and a pale colour only ever adds up to white
      ctx.fillStyle = fillFor(ctx, colors[color][0], range);
      ctx.fill(between(stretch(exits, from, to), stretch(aways, from, to)));
    });
  });

  ctx.restore();
};
