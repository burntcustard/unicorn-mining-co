import { createPath } from './drawing-path';
import { withAlpha } from './color';
import * as Vec from './vector';
import { directionOf, rotatePoint, rotatePoints } from './geometry';
import { shapePath, strip } from './drawing';
import { colors } from '../../specs/colors';
import { renderSurface } from './composited-surface';
import {
  Asteroid,
  shapeOutlineOf as asteroidShapeOutlineOf,
} from '../objects/asteroid';
import { type Pose, type ShapeOutline, type Segment } from '../types';
import { type GameObject } from '../objects/game-object';

type Crossing = {
  at: Vec.Value;
  away?: Vec.Value;
  distance: number;
  face: number;
  length?: number;
  normal: Vec.Value;
};

type Ray = {
  at: Vec.Value;
  distance?: number;
  hit?: ShapeOutline;
  out?: Crossing;
};

type CompleteRay = Ray & {
  hit: ShapeOutline;
  out: Crossing & { away: Vec.Value; length: number };
};

type BoundedPolygon = {
  shapeOutline: ShapeOutline;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export interface Beam {
  mask: Path2D;
  objects?: GameObject[];
  shapeOutlines: ShapeOutline[];
  rays: Ray[];
}

type Lamp = Segment;

type Scenery = GameObject & { shapeOutline?: ShapeOutline; scenery?: boolean };

const interiors = new WeakMap<
  Beam,
  {
    path: Path2D;
    bounds: { left: number; right: number; top: number; bottom: number };
  }
>();

const fillOf = (
  ctx: CanvasRenderingContext2D,
  color: string,
  from: Vec.Value,
  to: Vec.Value,
  fade: number,
) => {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);

  gradient.addColorStop(0, color);
  gradient.addColorStop(fade, color);
  gradient.addColorStop(1, withAlpha({ color: '#000', alpha: 0 }));

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
 * that line is cut across into equal stripes, one a color, each thrown out
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
const rockIndex = 1.2;

// How wide the stripes fan apart, measured against how far the rock bent the
// light on its way through. A rock that hardly bends it hardly splits it, so
// there is no width to swap ends when which end is the red one changes over
const fanning = 0.6;

// At a square face the turn can wobble either side of zero from one frame to
// the next. Keep this narrow middle range in one spectrum order.
const flipMargin = 0.01;

// How far past the width it started at a sheet is ever allowed to open out.
// However hard a rock bends the light, a beam squeezed to a sliver on its way
// through only has a sliver of light to split, and a rainbow that opened out of
// all proportion to it would be color coming from nowhere
const spreading = 1.2;

// Narrower than this and a sheet is a thread a pixel or so across, too thin to
// read as a rainbow and not worth the seven stripes it would be cut into
const thin = 4;

// How square-on a ray has to strike a rock to get into it at all. SearchLight that
// only grazes a face barely gets through one in the first place, and what does
// leaves from somewhere wildly far round the far side, sweeping about as the
// ship drifts, so it is taken as stopping at the face instead
const minFacing = 0.3;

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
 * points: A shape outline in the lamp's frame.
 * from: Where the ray starts.
 * dir: Which way it goes, as a unit vector.
 */
const cross = (
  points: ShapeOutline,
  from: Vec.Value,
  dir: Vec.Value,
): Crossing | undefined => {
  let near = Infinity;
  let faceIndex = 0;
  let normalX = 0;
  let normalY = 0;

  for (let i = 0; i < points.length; i++) {
    const corner = points[i];
    const next = points[(i + 1) % points.length];
    const edgeX = next[0] - corner[0];
    const edgeY = next[1] - corner[1];
    const denom = dir.x * edgeY - dir.y * edgeX;

    if (!denom) continue;
    const startX = corner[0] - from.x;
    const startY = corner[1] - from.y;
    const along = (startX * dir.y - startY * dir.x) / denom;
    const distance = (startX * edgeY - startY * edgeX) / denom;

    if (along < 0 || along > 1 || distance < inset || distance >= near) {
      continue;
    }

    near = distance;
    faceIndex = i;
    const sense = denom > 0 ? -1 : 1;

    normalX = edgeY * sense;
    normalY = -edgeX * sense;
  }

  return near < Infinity
    ? {
        at: Vec.addScaled(from, dir, near),
        distance: near,
        face: faceIndex,
        normal: Vec.normalize(Vec.create(normalX, normalY)),
      }
    : undefined;
};

/**
 * Snell's law. A ray that would be trapped inside instead leaves along the face
 * it hit, which keeps a band that is on the edge of being trapped from blinking
 * out of existence as the ship drifts.
 *
 * dir: Which way the light is going.
 * normal: The face it is crossing, facing back at it.
 * index: How much the material it is entering slows it down.
 */
const refract = (dir: Vec.Value, normal: Vec.Value, index: number) => {
  const facing = -Vec.dot(dir, normal);
  // Both roots are held to what they can really be, because a ray meeting a
  // face square on, or one right on the edge of being trapped, comes out a hair
  // the wrong side of that and the root of it is not a number
  const square = Math.max(0, 1 - facing * facing);
  const eta = Math.min(index, 1 / Math.sqrt(square));
  const sideways = Math.min(1, eta * eta * square);

  return Vec.add(
    Vec.scale(dir, eta),
    Vec.scale(normal, eta * facing - Math.sqrt(1 - sideways)),
  );
};

// One scenery object's shape in the lamp's frame.
const shapeOutlineOf = (ship: Pose, lamp: Segment, object: Scenery) => {
  const middle = Vec.subtract(
    rotatePoint(Vec.subtract(object.position, ship.position), -ship.rotation),
    lamp.localPosition,
  );
  const turn = object.rotation - ship.rotation;
  const shapeOutline = rotatePoints(
    object instanceof Asteroid
      ? asteroidShapeOutlineOf(object)
      : object.shapeOutline!,
    turn,
    middle,
  );

  return shapeOutline;
};

/**
 * One ray, all the way through. Where it stops is where the light stops, and
 * what it found on the way is everything the rainbow needs.
 */
const rayAt = (
  polygons: BoundedPolygon[],
  angle: number,
  range: number,
): Ray => {
  const dir = directionOf(angle);
  const from = Vec.create();
  let entry: Crossing | Ray = { at: Vec.scale(dir, range), distance: range };
  let hit: ShapeOutline | undefined;

  polygons.forEach(({ shapeOutline, left, right, top, bottom }) => {
    // Rays point along positive x in the lamp's frame. Reuse each polygon's
    // bounds to reject a missed slab before examining its individual edges.
    const near = Math.max(0, left / dir.x);
    const far = Math.min(entry.distance, right / dir.x);

    if (far + inset < near) return;

    if (!dir.y) {
      if (top > 0 || bottom < 0) return;
    } else {
      const a = top / dir.y;
      const b = bottom / dir.y;

      if (Math.min(a, b) > far + inset || Math.max(a, b) < near - inset) return;
    }

    const found = cross(shapeOutline, from, dir);

    if (found && found.distance < entry.distance) {
      entry = found;
      hit = shapeOutline;
    }
  });

  if (!hit) return entry;

  const crossing = entry as Crossing;
  const into =
    -Vec.dot(dir, crossing.normal) >= minFacing &&
    refract(dir, crossing.normal, 1 / rockIndex);
  const out = into && cross(hit, crossing.at, into);

  if (!out) return { at: crossing.at };

  out.away = refract(into, out.normal, rockIndex);
  // Whatever is left of the lamp's reach by the time the rock was reached.
  // Crossing it costs nothing, or a rock far enough off, or thick enough,
  // would swallow the whole of the reach and throw nothing out the far side.
  out.length = range - crossing.distance;

  return {
    at: crossing.at,
    // Only ever the rock this ray went into, so light that comes out the far
    // side carries on into open space rather than through whatever is behind
    hit,
    out,
  };
};

/**
 * Follow the whole cone. Everything drawn afterwards reads this and works
 * nothing out for itself.
 *
 * ship: Whatever is carrying the lamp.
 * lamp: The lit segment, mounted at `x`, `y` on the ship.
 * scenery: Anything that might be in the way.
 */
export const traceBeam = (
  ship: Pose,
  lamp: Lamp,
  scenery: GameObject[],
): Beam => {
  const { reach, spread } = lamp.module;
  const range = Math.hypot(reach, spread);
  const edge = Math.atan2(spread, reach);
  const mask = createPath();
  const objects = scenery.filter(
    (object): object is Scenery =>
      !!object.scenery &&
      (object instanceof Asteroid || !!object.shapeOutline) &&
      Vec.distance(object.position, ship.position) - object.radius < range,
  );
  const shapeOutlines = objects.map((object) =>
    shapeOutlineOf(ship, lamp, object),
  );

  const bounds = shapeOutlines.map((points) => {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;

    points.forEach(([x, y]) => {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    });

    return { left, right, top, bottom, shapeOutline: points };
  });

  // A rock outside the cone's bounds cannot be the first crossing.
  const candidates = bounds.filter(({ left, right, top, bottom }) => {
    return left <= range && right >= 0 && top <= spread && bottom >= -spread;
  });

  const fan = Array.from({ length: rays + 1 }, (_, i) =>
    rayAt(candidates, edge * ((i * 2) / rays - 1), range),
  );
  const hits = new Set(fan.filter((ray) => ray.out).map((ray) => ray.hit));

  const beam = {
    mask,
    objects: objects.filter((_, index) => hits.has(shapeOutlines[index])),
    shapeOutlines,
    rays: fan,
  };

  const interior = insideBounds(beam);

  // Only rock intersecting the lit interior can affect either interior clip.
  // Keep overlapping rocks too, preserving the complete mask's coverage while
  // avoiding a canvas clip containing every asteroid around the ship.
  shapeOutlines.forEach((points, index) => {
    const { left, right, top, bottom } = bounds[index];

    if (
      left <= interior.right &&
      right >= interior.left &&
      top <= interior.bottom &&
      bottom >= interior.top
    ) {
      mask.addPath(shapePath(points));
    }
  });

  return beam;
};

// Neighbouring rays that went into the same rock and left it as one sheet of
// light. A lone ray is too thin to draw.
//
// Straight and outward corners stay continuous; inward corners separate sheets.
// Drilled sides can retain collinear vertices. Allow roundoff in their signed
// turn, relative to edge lengths so rotation and asteroid size cannot split them.
// Asteroid shape outlines, including cut children, run counter-clockwise.
const joins = (points: ShapeOutline, from: number, to: number) => {
  if (from === to) return true;

  const count = points.length;

  if ((from + 1) % count !== to) [from, to] = [to, from];

  if ((from + 1) % count !== to) return false;

  const corner = Vec.create(...points[to]);
  const before = Vec.subtract(corner, Vec.create(...points[from]));
  const after = Vec.subtract(Vec.create(...points[(to + 1) % count]), corner);

  return (
    Vec.cross(before, after) >= -1e-8 * Vec.length(before) * Vec.length(after)
  );
};

const runsOf = ({ rays: fan }: Beam) => {
  const runs: CompleteRay[][] = [];

  fan.forEach((ray, i) => {
    if (!ray.hit || !ray.out?.away || ray.out.length === undefined) return;
    const complete = ray as CompleteRay;

    const last = fan[i - 1];

    if (
      last?.out &&
      last.hit === complete.hit &&
      joins(complete.hit, last.out.face, complete.out.face)
    ) {
      runs.at(-1)!.push(complete);
    } else {
      runs.push([complete]);
    }
  });

  return runs.filter((run) => run.length > 1);
};

// One non-converging exit edge shared by the light inside a rock and the
// rainbow outside it. It follows the real exit face, but never becomes
// narrower across the beam than the edge that entered the rock.
const sheetOf = (run: CompleteRay[]) => {
  const first = run[0];
  const last = run.at(-1);
  const through = Vec.normalize(
    run.reduce(
      (sum, ray) => Vec.add(sum, Vec.subtract(ray.out.at, ray.at)),
      Vec.create(),
    ),
  );
  const side = Vec.create(-through.y, through.x);
  let span = Vec.subtract(last.out.at, first.out.at);
  const feedWidth = Vec.dot(Vec.subtract(last.at, first.at), side);
  let width = Vec.dot(span, side);

  if (width * feedWidth < 0) {
    span = Vec.scale(span, -1);
    width = -width;
  }

  if (Math.abs(width) < Math.abs(feedWidth)) {
    span = width
      ? Vec.scale(span, feedWidth / width)
      : Vec.scale(side, feedWidth);
  }

  return {
    middle: Vec.scale(Vec.add(last.out.at, first.out.at), 0.5),
    side,
    span,
  };
};

// How far the light got, as the fan of everywhere its rays stopped
export const litPath = ({ rays: fan }: Beam) => {
  const path = createPath();

  path.moveTo(0, 0);
  fan.forEach(({ at }) => path.lineTo(at.x, at.y));
  path.closePath();

  return path;
};

// The slice of rock the light is actually crossing, from where it went in to
// where it came out again
const interiorOf = (beam: Beam) => {
  const cached = interiors.get(beam);

  if (cached) return cached;
  const path = createPath();

  const bounds = {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity,
  };

  const include = ({ x, y }: Vec.Value) => {
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  };

  runsOf(beam).forEach((run) => {
    const { middle, span } = sheetOf(run);
    const edge = Vec.scale(span, 0.5);
    const far = [Vec.subtract(middle, edge), Vec.add(middle, edge)];

    run.forEach((ray) => {
      include(ray.at);
      include(ray.out.at);
    });

    far.forEach(include);

    path.addPath(strip(run));
    path.addPath(strip(run, far));
  });

  const interior = { path, bounds };

  interiors.set(beam, interior);
  return interior;
};

export const insidePath = (beam: Beam) => interiorOf(beam).path;
export const insideBounds = (beam: Beam) => interiorOf(beam).bounds;

export const drawInside = (
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  beam: Beam,
) => {
  if (insideBounds(beam).left === Infinity) return;

  const path = insidePath(beam);

  const draw = (
    paint: CanvasRenderingContext2D,
    composite: GlobalCompositeOperation,
  ) => {
    paint.save();
    paint.clip(beam.mask);
    paint.globalCompositeOperation = composite;
    paint.globalAlpha = lamp.activationProgress;
    paint.fillStyle = inside;
    paint.strokeStyle = inside;
    paint.lineWidth = 1;
    paint.fill(path);
    // Close the hairline seams between adjacent sheets with the same color.
    paint.stroke(path);
    paint.restore();
  };

  if (
    !renderSurface({
      ctx,
      key: lamp,
      bounds: insideBounds(beam),
      light: true,
      draw: (paint) => draw(paint, 'source-over'),
    })
  ) {
    draw(ctx, 'lighten');
  }
};

/**
 * The rainbow: each sheet of light leaving a rock, cut across its width into as
 * many equal stripes as there are colors. Stripes are laid down side by side
 * and added rather than overlapped, so where two of them meet the half of a
 * pixel each covers adds up to the whole of it, with no bright seam between
 * them and no thread of background showing through either. Sheets crossing one
 * another add up the same way: each is light, and light fades to nothing rather
 * than to a color, so neither can take anything away from the other.
 */
type Spectrum = {
  bounds: { left: number; right: number; top: number; bottom: number };
  bands: {
    path: Path2D;
    color: string;
    from: Vec.Value;
    to: Vec.Value;
    fade: number;
  }[];
};

const spectra = new WeakMap<Beam, Spectrum>();

const spectrumOf = (beam: Beam) => {
  const cached = spectra.get(beam);

  if (cached) return cached;

  const result: Spectrum = {
    bounds: {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    },
    bands: [],
  };

  const edges = Array.from(
    { length: spectrum.length + 1 },
    (_, i) => i / spectrum.length,
  );

  runsOf(beam).forEach((run) => {
    const away = Vec.normalize(
      run.reduce((sum, { out }) => Vec.add(sum, out.away), Vec.create()),
    );
    const length =
      run.reduce((sum, { out }) => sum + out.length, 0) / run.length;
    // Rays set off from the lamp itself, so where one went into a rock is also
    // the way it was going, and against where it ended up pointing that says
    // how far round the rock turned it, and which way
    const into = Vec.normalize(run[run.length >> 1].at);
    const spin = Vec.cross(into, away);
    const { middle, side, span } = sheetOf(run);
    // Its sign is which way round the fan has to open for the stripes to spread
    // apart rather than cross over one another
    const width = Vec.dot(span, side);

    if (Math.abs(width) < thin) return;

    const sense = width > 0 ? 1 : -1;
    const turn =
      sense *
      Math.min(
        fanning * Math.abs(spin),
        (Math.abs(width) * spreading) / length,
      );
    const near = edges.map((across) =>
      Vec.addScaled(middle, span, across - 0.5),
    );
    const far = edges.map((across, i) =>
      Vec.addScaled(near[i], rotatePoint(away, turn * (across - 0.5)), length),
    );

    // Squarely down the way the light is going, so a sheet gives out level with
    // the face it came through rather than around one corner of it
    const root = near[spectrum.length >> 1];
    const tip = Vec.addScaled(root, away, length);

    [...near, ...far].forEach(({ x, y }) => {
      result.bounds.left = Math.min(result.bounds.left, x);
      result.bounds.right = Math.max(result.bounds.right, x);
      result.bounds.top = Math.min(result.bounds.top, y);
      result.bounds.bottom = Math.max(result.bounds.bottom, y);
    });

    // Violet is bent furthest, so it belongs on the side the rock bent toward
    spectrum.forEach((_, band) => {
      result.bands.push({
        color:
          spectrum[
            sense * spin > -flipMargin ? band : spectrum.length - 1 - band
          ],
        from: root,
        to: tip,
        fade: Math.max(0, 1 - fades / length),
        path: strip(near.slice(band, band + 2), far.slice(band, band + 2)),
      });
    });
  });

  spectra.set(beam, result);
  return result;
};

export const drawSpectrum = (
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  beam: Beam,
) => {
  const { bands, bounds } = spectrumOf(beam);

  if (!bands.length) return;

  if (
    renderSurface({
      ctx,
      key: lamp,
      bounds,
      floor: true,
      additive: true,
      draw: (paint) => drawSpectrum(paint, lamp, beam),
    })
  ) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = lamp.activationProgress * spectrumStrength;

  bands.forEach(({ path, color, from, to, fade }) => {
    ctx.fillStyle = fillOf(ctx, color, from, to, fade);
    ctx.fill(path);
  });

  ctx.restore();
};
