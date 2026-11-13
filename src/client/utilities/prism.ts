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
  filterAt?: Vec.Value;
  filterColor?: string;
};

type CompleteRay = Ray & {
  hit: ShapeOutline;
  out: Crossing & { away: Vec.Value; length: number };
};

type BoundedPolygon = {
  shapeOutline: ShapeOutline;
  object: GameObject;
  rock: boolean;
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

const interiors = new WeakMap<
  Beam,
  {
    path: Path2D;
    bounds: { left: number; right: number; top: number; bottom: number };
  }
>();

const obstacles = new WeakMap<Beam, BoundedPolygon[]>();
const incoming = new WeakMap<CompleteRay, Vec.Value>();

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
 * of the lamp's reach untouched, stops at a physical object, or meets a rock,
 * bends going in, crosses it, and bends again coming out. The spectrum is cut
 * short by any further physical object.
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

// One collider's shape in the lamp's frame.
const shapeOutlineOf = (
  ship: Pose,
  lamp: Segment,
  pose: Pose,
  points: ShapeOutline,
) => {
  const middle = Vec.subtract(
    rotatePoint(Vec.subtract(pose.position, ship.position), -ship.rotation),
    lamp.localPosition,
  );

  return rotatePoints(points, pose.rotation - ship.rotation, middle);
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
  let rock = false;

  let filter: { at: Vec.Value; distance: number; color: string } | undefined;

  polygons.forEach(
    ({ shapeOutline, left, right, top, bottom, rock: isRock, object }) => {
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

        if (Math.min(a, b) > far + inset || Math.max(a, b) < near - inset) {
          return;
        }
      }

      const found = cross(shapeOutline, from, dir);

      if (found && found.distance < entry.distance) {
        const color = object.lightFilter;

        if (color) {
          if (!filter || found.distance < filter.distance) {
            filter = { at: found.at, distance: found.distance, color };
          }
        } else {
          entry = found;
          hit = shapeOutline;
          rock = isRock;
        }
      }
    },
  );

  const filtered =
    filter && filter.distance < entry.distance ? filter : undefined;
  const filterAt = filtered?.at;
  const filterColor = filtered?.color;

  if (!hit) return { ...entry, filterAt, filterColor };

  if (!rock) return { at: entry.at, filterAt, filterColor };

  const crossing = entry as Crossing;
  const into =
    -Vec.dot(dir, crossing.normal) >= minFacing &&
    refract(dir, crossing.normal, 1 / rockIndex);
  const out = into && cross(hit, crossing.at, into);

  if (!out) return { at: crossing.at, filterAt, filterColor };

  out.away = refract(into, out.normal, rockIndex);
  // Whatever is left of the lamp's reach by the time the rock was reached.
  // Crossing it costs nothing, or a rock far enough off, or thick enough,
  // would swallow the whole of the reach and throw nothing out the far side.
  out.length = range - crossing.distance;

  return {
    at: crossing.at,
    filterAt,
    filterColor,
    // The rock this ray entered supplies its interior and spectrum.
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
  owner?: GameObject,
  poses?: ReadonlyMap<number, Pose>,
): Beam => {
  const { reach, spread } = lamp.module;
  const range = Math.hypot(reach, spread);
  const edge = Math.atan2(spread, reach);
  const mask = createPath();

  const polygons: {
    object: GameObject;
    rock: boolean;
    points: ShapeOutline;
  }[] = [];

  const lens = Vec.add(
    ship.position,
    rotatePoint(lamp.localPosition, ship.rotation),
  );

  scenery.forEach((object) => {
    if (object.dead || object.buried || !object.physics) return;
    const pose = poses?.get(object.id) || object;

    if (Vec.distance(pose.position, lens) - object.radius > range * 2) return;

    if (object instanceof Asteroid) {
      polygons.push({
        object,
        rock: true,
        points: shapeOutlineOf(
          ship,
          lamp,
          pose,
          asteroidShapeOutlineOf(object),
        ),
      });

      return;
    }

    object.hitbox().forEach((collider) => {
      if (
        collider.physics === false ||
        collider.pickupPoint ||
        collider.dockSegment
      ) {
        return;
      }

      const offset =
        collider.localPosition ||
        rotatePoint(
          Vec.subtract(collider.position, object.position),
          -object.rotation,
        );
      const position = Vec.add(
        pose.position,
        rotatePoint(offset, pose.rotation),
      );
      const rotation = pose.rotation + collider.rotation - object.rotation;

      const points = collider.shapeOutline?.length
        ? collider.shapeOutline
        : Array.from({ length: 32 }, (_, index) => {
            const angle = (index * Math.PI * 2) / 32;

            return [
              Math.cos(angle) * collider.radius,
              Math.sin(angle) * collider.radius,
            ];
          });

      const outline = shapeOutlineOf(
        ship,
        lamp,
        { position, rotation },
        points,
      );

      // A lens embedded in its own housing must not be blocked by the exit face.
      if (object.id === owner?.id) {
        let inside = false;

        outline.forEach(([x, y], index) => {
          const [nextX, nextY] = outline[(index + 1) % outline.length];

          if (y > 0 !== nextY > 0 && x + ((nextX - x) * -y) / (nextY - y) > 0) {
            inside = !inside;
          }
        });

        if (inside) return;
      }

      polygons.push({ object, rock: false, points: outline });
    });
  });

  const shapeOutlines = polygons
    .filter(({ rock }) => rock)
    .map(({ points }) => points);

  const bounds = polygons.map(({ points, object, rock }) => {
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

    return { left, right, top, bottom, shapeOutline: points, object, rock };
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
    objects: polygons
      .filter(({ points, rock }) => rock && hits.has(points))
      .map(({ object }) => object),
    shapeOutlines,
    rays: fan,
  };

  obstacles.set(beam, bounds);

  const interior = insideBounds(beam);

  // Only rock intersecting the lit interior can affect either interior clip.
  // Keep overlapping rocks too, preserving the complete mask's coverage while
  // avoiding a canvas clip containing every asteroid around the ship.
  bounds.forEach(({ shapeOutline: points, left, right, top, bottom, rock }) => {
    if (
      rock &&
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

  fan.forEach(({ at, filterAt }) => {
    const end = filterAt || at;

    path.lineTo(end.x, end.y);
  });

  path.closePath();

  return path;
};

// Each run carries the filtered light straight on, through the item and up to
// the next opaque object or the remaining reach of the original beam.
export const filteredPaths = ({ rays: fan }: Beam) => {
  const paths = new Map<string, Path2D>();
  let run: Ray[] = [];

  const finish = () => {
    if (run.length) {
      const color = run[0].filterColor!;
      let path = paths.get(color);
      let near = run.map((ray) => ray.filterAt!);
      let far = run.map((ray) => ray.at);

      if (run.length === 1) {
        // A distant gem can cover just one sample. Give that ray its share of
        // the fan instead of dropping its filtered light altogether.
        const index = fan.indexOf(run[0]);
        const neighbor = fan[index + 1] || fan[index - 1];
        const direction = Vec.normalize(run[0].at);
        const side = Vec.create(-direction.y, direction.x);
        const angle = neighbor
          ? Math.abs(
              Math.atan2(
                Vec.cross(direction, neighbor.at),
                Vec.dot(direction, neighbor.at),
              ),
            )
          : 0;

        const edges = (point: Vec.Value) => {
          const width = (Vec.length(point) * angle) / 2;

          return [
            Vec.addScaled(point, side, -width),
            Vec.addScaled(point, side, width),
          ];
        };

        near = edges(near[0]);
        far = edges(far[0]);
      }

      if (!path) paths.set(color, (path = createPath()));
      path.addPath(strip(near, far));
    }

    run = [];
  };

  fan.forEach((ray) => {
    if (
      !ray.filterAt ||
      (run.length && ray.filterColor !== run[0].filterColor)
    ) {
      finish();
    }

    if (ray.filterAt) run.push(ray);
  });

  finish();
  return paths;
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
    const middleRay = run[run.length >> 1];
    const into = incoming.get(middleRay) || Vec.normalize(middleRay.at);
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

    const line = (across: number) => {
      const start = Vec.addScaled(middle, span, across - 0.5);
      const direction = rotatePoint(away, turn * (across - 0.5));
      const end = Vec.addScaled(start, direction, length);
      let distance = length;
      let filterDistance = length;
      let filterColor: string | undefined;

      obstacles
        .get(beam)
        ?.forEach(({ shapeOutline, left, right, top, bottom, object }) => {
          if (
            shapeOutline === run[0].hit ||
            left > Math.max(start.x, end.x) ||
            right < Math.min(start.x, end.x) ||
            top > Math.max(start.y, end.y) ||
            bottom < Math.min(start.y, end.y)
          ) {
            return;
          }

          const found = cross(shapeOutline, start, direction);

          if (!found) return;
          const color = object.lightFilter;

          if (color && found.distance < filterDistance) {
            filterDistance = found.distance;
            filterColor = color;
          } else if (!color) {
            distance = Math.min(distance, found.distance);
          }
        });

      const filtered = filterColor && filterDistance < distance;

      return {
        start,
        end: Vec.addScaled(
          start,
          direction,
          filtered ? filterDistance : distance,
        ),
        filteredEnd: Vec.addScaled(start, direction, distance),
        filterColor: filtered ? filterColor : undefined,
      };
    };

    const near = edges.map((across) =>
      Vec.addScaled(middle, span, across - 0.5),
    );

    // Squarely down the way the light is going, so a sheet gives out level with
    // the face it came through rather than around one corner of it
    const root = near[spectrum.length >> 1];
    const tip = Vec.addScaled(root, away, length);
    // Adjacent colors share their edge samples, including any obstruction.
    const samples = Array.from({ length: spectrum.length * 8 + 1 }, (_, i) =>
      line(i / (spectrum.length * 8)),
    );

    // Violet is bent furthest, so it belongs on the side the rock bent toward
    spectrum.forEach((_, band) => {
      // Subdivide the band so a small object can cut a notch in its interior,
      // not just at the edges between colors.
      const lines = samples.slice(band * 8, band * 8 + 9);

      lines
        .flatMap(({ start, end, filteredEnd }) => [start, end, filteredEnd])
        .forEach(({ x, y }) => {
          result.bounds.left = Math.min(result.bounds.left, x);
          result.bounds.right = Math.max(result.bounds.right, x);
          result.bounds.top = Math.min(result.bounds.top, y);
          result.bounds.bottom = Math.max(result.bounds.bottom, y);
        });

      result.bands.push({
        color:
          spectrum[
            sense * spin > -flipMargin ? band : spectrum.length - 1 - band
          ],
        from: root,
        to: tip,
        fade: Math.max(0, 1 - fades / length),
        path: strip(
          lines.map(({ start }) => start),
          lines.map(({ end }) => end),
        ),
      });

      let filtered: typeof lines = [];

      const finish = () => {
        if (filtered.length > 1) {
          result.bands.push({
            color: filtered[0].filterColor!,
            from: root,
            to: tip,
            fade: Math.max(0, 1 - fades / length),
            path: strip(
              filtered.map(({ end }) => end),
              filtered.map(({ filteredEnd }) => filteredEnd),
            ),
          });
        }

        filtered = [];
      };

      lines.forEach((line) => {
        if (
          !line.filterColor ||
          (filtered.length && line.filterColor !== filtered[0].filterColor)
        ) {
          finish();
        }

        if (line.filterColor) filtered.push(line);
      });

      finish();
    });
  });

  spectra.set(beam, result);
  return result;
};

export const drawSpectrum = (
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  beam: Beam,
  key: object = lamp,
) => {
  const { bands, bounds } = spectrumOf(beam);

  if (!bands.length) return;

  if (
    renderSurface({
      ctx,
      key,
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

// A source's pose is the world position and direction of its lens. Sheets
// retain their own asteroid and source so they can be compared across craft.
type SpectrumSource = [Lamp, Beam, Pose];
type SpectrumSheet = [SpectrumSource, CompleteRay[], GameObject];

let pendingSpectra: SpectrumSource[] | undefined;
const spectrumKeys = new WeakMap<Lamp, object[]>();
const sameDirection = Math.cos(Math.PI / 9);

export const beginSpectra = () => {
  pendingSpectra = [];
};

export const collectSpectrum = (
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  beam: Beam,
  pose: Pose,
) => {
  if (!pendingSpectra) {
    drawSpectrum(ctx, lamp, beam);
    return;
  }

  if (!beam.rays.some((ray) => ray.out?.away)) return;

  pendingSpectra.push([
    lamp,
    beam,
    {
      position: Vec.add(
        pose.position,
        rotatePoint(lamp.localPosition, pose.rotation),
      ),
      rotation: pose.rotation,
    },
  ]);
};

const pointInFrame = (point: Vec.Value, from: Pose, to: Pose) =>
  Vec.add(
    rotatePoint(point, from.rotation - to.rotation),
    rotatePoint(Vec.subtract(from.position, to.position), -to.rotation),
  );

const runInFrame = (
  run: CompleteRay[],
  from: Pose,
  to: Pose,
  hit: ShapeOutline,
) => {
  if (from === to && run[0].hit === hit) return run;
  const turn = from.rotation - to.rotation;

  return run.map((ray) => {
    const transformed: CompleteRay = {
      at: pointInFrame(ray.at, from, to),
      hit,
      out: {
        ...ray.out,
        at: pointInFrame(ray.out.at, from, to),
        normal: rotatePoint(ray.out.normal, turn),
        away: rotatePoint(ray.out.away, turn),
      },
    };

    incoming.set(transformed, rotatePoint(Vec.normalize(ray.at), turn));
    return transformed;
  });
};

const directionOfRun = (run: CompleteRay[]) =>
  Vec.normalize(
    run.reduce((sum, ray) => Vec.add(sum, ray.out.away), Vec.create()),
  );

const canCombine = (first: CompleteRay[], second: CompleteRay[]) => {
  const firstAway = directionOfRun(first);
  const secondAway = directionOfRun(second);
  const firstMiddle = first[first.length >> 1];
  const secondMiddle = second[second.length >> 1];
  const firstInto = incoming.get(firstMiddle) || Vec.normalize(firstMiddle.at);
  const secondInto =
    incoming.get(secondMiddle) || Vec.normalize(secondMiddle.at);

  if (
    Vec.dot(firstAway, secondAway) < sameDirection ||
    Vec.dot(firstInto, secondInto) < sameDirection ||
    ![first[0], first.at(-1)!].some((a) =>
      [second[0], second.at(-1)!].some((b) =>
        joins(first[0].hit, a.out.face, b.out.face),
      ),
    )
  ) {
    return false;
  }

  const side = Vec.create(-firstAway.y, firstAway.x);

  const extent = (run: CompleteRay[], along: number) => {
    const values = run.map((ray) =>
      Vec.dot(
        Vec.addScaled(ray.at, Vec.subtract(ray.out.at, ray.at), along),
        side,
      ),
    );

    return [Math.min(...values), Math.max(...values)];
  };

  // The sheets can overlap inside the rock and diverge before they exit.
  return [0, 0.5, 1].some((along) => {
    const [firstMin, firstMax] = extent(first, along);
    const [secondMin, secondMax] = extent(second, along);

    return firstMin <= secondMax && secondMin <= firstMax;
  });
};

// Group overlapping sheets inside the same asteroid in similar directions.
// Reproject their rays into the first lens's frame, then split the union into
// colors once. Individual light beams and rock interiors stay intact.
const combineSpectra = (sources: SpectrumSource[]): SpectrumSource[] => {
  const sheets: SpectrumSheet[] = [];
  const counts = new WeakMap<Beam, number>();

  sources.forEach((source) => {
    const [, beam] = source;
    const runs = runsOf(beam);

    counts.set(beam, runs.length);

    runs.forEach((run) => {
      const asteroid = obstacles
        .get(beam)
        ?.find(({ shapeOutline }) => shapeOutline === run[0].hit)?.object;

      if (!asteroid) return;
      sheets.push([source, run, asteroid]);
    });
  });

  // Connected components make the result independent of collection order: a
  // third sheet can bridge two sheets that do not overlap each other.
  const parents = sheets.map((_, index) => index);

  const root = (index: number) => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };

  const byAsteroid = new Map<number, number[]>();

  sheets.forEach(([source, run, rock], index) => {
    let nearby = byAsteroid.get(rock.id);

    if (!nearby) byAsteroid.set(rock.id, (nearby = []));

    nearby.forEach((other) => {
      const [otherSource, otherRun] = sheets[other];

      if (root(index) === root(other)) return;
      const transformed = runInFrame(
        run,
        source[2],
        otherSource[2],
        otherRun[0].hit,
      );

      if (canCombine(otherRun, transformed)) parents[root(index)] = root(other);
    });

    nearby.push(index);
  });

  const grouped = new Map<number, SpectrumSheet[]>();

  sheets.forEach(([source, run, rock], index) => {
    const key = root(index);
    let group = grouped.get(key);

    if (!group) grouped.set(key, (group = []));
    const [reference, first] = group[0] || [];

    group.push([
      source,
      reference ? runInFrame(run, source[2], reference[2], first[0].hit) : run,
      rock,
    ]);
  });

  return Array.from(grouped.values(), (group) => {
    const [reference, first, rock] = group[0];
    const [lamp, beam, pose] = reference;

    if (group.length === 1 && counts.get(beam) === 1) return reference;
    const rays = group.flatMap(([, run]) => run);

    if (group.length > 1) {
      const axis = Vec.normalize(
        Vec.subtract(first.at(-1)!.out.at, first[0].out.at),
      );

      rays.sort((a, b) => Vec.dot(a.out.at, axis) - Vec.dot(b.out.at, axis));
    }

    const merged = { ...beam, rays };
    const sources = new Set(group.map(([source]) => source));
    const bounds: BoundedPolygon[] = [];

    sources.forEach(([, sourceBeam, sourcePose]) => {
      obstacles.get(sourceBeam)?.forEach((polygon) => {
        if (sourceBeam === beam) {
          bounds.push(polygon);
          return;
        }

        const shapeOutline =
          polygon.rock && polygon.object.id === rock.id
            ? first[0].hit
            : rotatePoints(
                polygon.shapeOutline,
                sourcePose.rotation - pose.rotation,
                pointInFrame(Vec.create(), sourcePose, pose),
              );
        const xs = shapeOutline.map(([x]) => x);
        const ys = shapeOutline.map(([, y]) => y);

        bounds.push({
          ...polygon,
          shapeOutline,
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        });
      });
    });

    obstacles.set(merged, bounds);

    const strongest = group.reduce(
      (best, [source]) =>
        source[0].activationProgress > best.activationProgress
          ? source[0]
          : best,
      lamp,
    );

    return [strongest, merged, pose];
  });
};

export const endSpectra = (ctx: CanvasRenderingContext2D) => {
  const sources = pendingSpectra || [];

  pendingSpectra = undefined;
  const counts = new Map<Lamp, number>();

  combineSpectra(sources).forEach(([lamp, beam, pose]) => {
    const count = counts.get(lamp) || 0;
    const keys = spectrumKeys.get(lamp) || [];
    const key = count ? (keys[count] ||= {}) : lamp;

    counts.set(lamp, count + 1);
    spectrumKeys.set(lamp, keys);
    ctx.save();
    ctx.translate(pose.position.x, pose.position.y);
    ctx.rotate(pose.rotation);
    drawSpectrum(ctx, lamp, beam, key);
    ctx.restore();
  });
};
