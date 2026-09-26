import * as Vec from '../vector';
import { rotatePoint } from '../geometry';
import { createPolygon, outerEdges, radiusOf } from '../polygon';
import { createRandom } from '../seeded-random';
import { type AsteroidSegment } from '../protocol/entities';
import { addEntity, type SimulationWorld, entityId } from './world';
import { GameObject } from '../game-object';
import { type Collider } from '../collision/types';
import { type ShapeOutline } from '../types';
import { itemTypes } from '../items';
import { type SimulationEvent } from '../protocol/events';
import { round } from '../utilities/round';

// Enough of a wander that no two asteroids come out the same shape
export const asteroidVariance = 0.2;

// Bigger asteroids need more points to be lumpy with
export const pointCountFor = (radius: number) =>
  Math.round(Math.sqrt(radius) * 0.3) * 2 - 1;

const shapeOutlines = new Map<string, number[][]>();
const roundPoint = ([x, y]: number[]) => [round(x), round(y)];

const withoutCollinearPoints = (shapeOutline: number[][]) =>
  shapeOutline.filter((point, index) => {
    const before = shapeOutline.at(index - 1)!;
    const next = shapeOutline[(index + 1) % shapeOutline.length];

    return (
      (point[0] - before[0]) * (next[1] - point[1]) !==
      (point[1] - before[1]) * (next[0] - point[0])
    );
  });

/**
 * The shape an asteroid is actually cut to. Every copy of one, on any client
 * and on the server, is cut from its own id, so they all agree on it without
 * it ever going over the wire.
 */
export const shapeOutlineOf = (asteroid: Asteroid) => {
  if (asteroid.shapeOutline) return asteroid.shapeOutline;
  const key = [
    asteroid.id,
    asteroid.pointCount,
    asteroid.radius,
    asteroid.radiusEven,
  ].join(':');
  let shapeOutline = shapeOutlines.get(key);

  if (!shapeOutline) {
    const random = createRandom(asteroid.id);

    shapeOutline = createPolygon({
      pointCount: asteroid.pointCount || pointCountFor(asteroid.radius),
      radius: asteroid.radius,
      radiusEven: asteroid.radiusEven,
      random: random.next,
      variance: asteroidVariance,
    }).map(roundPoint);
    // A long session flies past more rock than is worth remembering.

    if (shapeOutlines.size > 5000) shapeOutlines.clear();
    shapeOutlines.set(key, shapeOutline);
  }
  return withoutCollinearPoints(shapeOutline);
};

const splitTriangle = (triangle: number[][]) => {
  const [center, from, to] = triangle;
  const between = (a: number[], b: number[]) => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const left = between(center, from);
  const outer = between(from, to);
  const right = between(to, center);

  return [
    [center, left, right],
    [left, from, outer],
    [left, outer, right],
    [outer, to, right],
  ];
};

const segmentsOf = ({
  contents,
  health,
  mass,
  shapeOutline,
  radiusEven,
  random,
}: {
  contents: number[];
  health: number;
  mass: number;
  shapeOutline: number[][];
  radiusEven?: number;
  random: () => number;
}) => {
  const inset = radiusEven && shapeOutline.filter((_, index) => !(index % 2));
  const triangles = inset
    ? [
        inset,
        ...inset.map((point, index) => [
          point,
          shapeOutline[index * 2 + 1],
          inset[(index + 1) % inset.length],
        ]),
      ]
    : shapeOutline[3]
      ? shapeOutline.map((point, index) => [
          [0, 0],
          point,
          shapeOutline[(index + 1) % shapeOutline.length],
        ])
      : [shapeOutline];
  const segmentsPerFace = inset ? 1 : 4;
  const leaves = triangles.map(
    inset ? (triangle) => [triangle] : splitTriangle,
  );
  const asteroidSegmentHealth = health / (triangles.length * segmentsPerFace);
  const asteroidSegmentMass = mass / (triangles.length * segmentsPerFace);
  // Match the original topology order: all centre leaves first, then the next
  // corner from every face. Cargo placement depends on that centre-first bias.
  const shapeOutlines = Array.from({ length: segmentsPerFace }, (_, corner) =>
    leaves.map((leaf) => leaf[corner]),
  ).flat();
  const segments: AsteroidSegment[] = shapeOutlines.map((asteroidSegment) => ({
    contents: [] as number[],
    health: asteroidSegmentHealth,
    mass: asteroidSegmentMass,
    maxHealth: asteroidSegmentHealth,
    shapeOutline: asteroidSegment.map(roundPoint),
  }));
  const empty = [...segments];

  contents.forEach((resource) => {
    const index = Math.floor(random() ** 2 * empty.length);

    (empty.splice(index, 1)[0] || segments[0]).contents.push(resource);
  });
  return segments;
};

const samePoint = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];

const groupsOf = (segments: AsteroidSegment[]) =>
  outerEdges(
    segments.map(({ shapeOutline }) => shapeOutline as ShapeOutline),
  ).map((indices) => indices.map((index) => segments[index]));

// groupsOf has already marked exterior edges on its connected groups.
const shapeOutlinesFromMarked = (segments: AsteroidSegment[]) => {
  const outer = segments.flatMap(({ shapeOutline }) => {
    const polygon = shapeOutline as ShapeOutline;

    return polygon.flatMap((from, index) =>
      polygon.edges?.[index]
        ? [{ from, to: polygon[(index + 1) % polygon.length] }]
        : [],
    );
  });
  const shapeOutlines: number[][][] = [];

  while (outer.length) {
    const first = outer.shift()!;
    const shapeOutline = [first.from];
    let edge = first;

    while (!samePoint(edge.to, first.from)) {
      const at = edge.to;
      // More than one loop can meet at a corner. The next clockwise edge
      // from the incoming reverse keeps each hole on its own boundary.
      const reverse = Math.atan2(edge.from[1] - at[1], edge.from[0] - at[0]);
      let nextIndex = -1;
      let smallestTurn = Infinity;

      outer.forEach((candidate, index) => {
        if (!samePoint(candidate.from, at)) return;
        const direction = Math.atan2(
          candidate.to[1] - at[1],
          candidate.to[0] - at[0],
        );
        const clockwise = (reverse - direction + Math.PI * 2) % (Math.PI * 2);

        if (clockwise < smallestTurn) {
          smallestTurn = clockwise;
          nextIndex = index;
        }
      });

      if (nextIndex < 0) break;
      shapeOutline.push(at);
      edge = outer.splice(nextIndex, 1)[0];
    }
    shapeOutlines.push(withoutCollinearPoints(shapeOutline));
  }
  return shapeOutlines;
};

export const shapeOutlinesFrom = (segments: AsteroidSegment[]) => {
  outerEdges(segments.map(({ shapeOutline }) => shapeOutline as ShapeOutline));
  return shapeOutlinesFromMarked(segments);
};

export const centerOf = (shapeOutline: number[][]) => {
  let area = 0;
  let x = 0;
  let y = 0;

  shapeOutline.forEach(([atX, atY], index) => {
    const [nextX, nextY] = shapeOutline[(index + 1) % shapeOutline.length];
    const cross = atX * nextY - nextX * atY;

    area += cross;
    x += (atX + nextX) * cross;
    y += (atY + nextY) * cross;
  });
  return Vec.create(x / (area * 3), y / (area * 3));
};

const detachSegment = ({
  asteroid,
  asteroidSegment,
  world,
}: {
  asteroid: Asteroid;
  asteroidSegment: AsteroidSegment;
  world: SimulationWorld;
}) => {
  const remaining = asteroid.segments!.filter(
    (candidate) => candidate !== asteroidSegment,
  );
  const groups = [[asteroidSegment], ...groupsOf(remaining)];

  asteroid.remove();
  const children = groups.map((group) => {
    const shapeOutline =
      group.length === 1
        ? group[0].shapeOutline
        : shapeOutlinesFromMarked(group).reduce((largest, candidate) =>
            radiusOf(candidate) > radiusOf(largest) ? candidate : largest,
          );
    const center = centerOf(shapeOutline);
    const offset = rotatePoint(center, asteroid.rotation);
    const local = ([x, y]: number[]) =>
      roundPoint([x - center.x, y - center.y]);
    const childShapeOutline = shapeOutline.map(local);
    const childSegments = group.map((asteroidSegment) => ({
      ...asteroidSegment,
      contents: [...asteroidSegment.contents],
      shapeOutline: asteroidSegment.shapeOutline.map(local),
    }));
    const contents = group.flatMap(
      (asteroidSegment) => asteroidSegment.contents,
    );
    const mass = group.reduce(
      (sum, asteroidSegment) => sum + asteroidSegment.mass,
      0,
    );
    const radius = radiusOf(childShapeOutline);
    const child = createAsteroid(world, {
      contents,
      decay: group.length === 1 && !contents.length ? 6 : undefined,
      health: radius,
      mass,
      maxHealth: radius,
      shapeOutline: childShapeOutline,
      position: Vec.add(asteroid.position, offset),
      radius,
      resource: asteroid.resource,
      rotation: asteroid.rotation,
      segments: group.length > 1 ? childSegments : undefined,
      spin: asteroid.spin,
      velocity: Vec.addScaled(
        asteroid.velocity,
        Vec.create(-offset.y, offset.x),
        asteroid.spin,
      ),
    });

    return addEntity(world, child);
  });
  const force = 3 / children.reduce((sum, child) => sum + 1 / child.mass, 0);
  const spin = ((createRandom(asteroid.id).next() - 0.5) * force) / 3;

  children.forEach((child) => {
    Vec.set(
      child.velocity,
      Vec.add(
        child.velocity,
        Vec.scale(
          Vec.normalize(Vec.subtract(child.position, asteroid.position)),
          force / child.mass,
        ),
      ),
    );
    child.spin += spin / child.mass;
  });
  return children;
};

/**
 * Whether a point lies within a shape cut radially about its own middle.
 */
const insideShapeOutline = ({
  shapeOutline,
  local,
}: {
  shapeOutline: number[][];
  local: Vec.Value;
}) => {
  const count = shapeOutline.length;
  const turn = Math.atan2(local.y, local.x) / (Math.PI * 2);
  const face = Math.floor((((turn % 1) + 1) % 1) * count);
  const [x, y] = shapeOutline[face];
  const [toX, toY] = shapeOutline[(face + 1) % count];
  // How far out the face between those two points sits, as a multiple of how
  // far out the point itself is.
  const across = local.x * (toY - y) - local.y * (toX - x);

  return !across || (x * toY - y * toX) / across > 1;
};

/**
 * Where a round body meets an asteroid's shape outline, rather than the circle that
 * only bounds it: the normal points out of the rock, towards the body.
 */
export const asteroidContact = ({
  asteroid,
  position,
  radius,
}: {
  asteroid: Asteroid;
  position: Vec.Value;
  radius: number;
}) => {
  const shapeOutline = shapeOutlineOf(asteroid);
  const offset = Vec.subtract(position, asteroid.position);
  const cosine = Math.cos(asteroid.rotation);
  const sine = Math.sin(asteroid.rotation);
  // The shape outline is cut in the asteroid's own frame, so the body comes to it.
  const local = Vec.create(
    offset.x * cosine + offset.y * sine,
    offset.y * cosine - offset.x * sine,
  );
  let closest = local;
  let nearest = Infinity;

  shapeOutline.forEach(([x, y], i) => {
    const [toX, toY] = shapeOutline[(i + 1) % shapeOutline.length];
    const edge = Vec.create(toX - x, toY - y);
    const along = Math.min(
      1,
      Math.max(
        0,
        Vec.dot(Vec.create(local.x - x, local.y - y), edge) /
          (Vec.dot(edge, edge) || 1),
      ),
    );
    const point = Vec.create(x + edge.x * along, y + edge.y * along);
    const distance = Vec.distance(point, local);

    if (distance < nearest) {
      nearest = distance;
      closest = point;
    }
  });

  const inside = insideShapeOutline({ shapeOutline, local });
  const overlap = inside ? radius + nearest : radius - nearest;

  if (overlap <= 0) return;

  const away = inside
    ? Vec.subtract(closest, local)
    : Vec.subtract(local, closest);
  const normal = Vec.length(away) ? Vec.normalize(away) : Vec.create(1, 0);

  return {
    // Back out into the world the body is actually moving through.
    normal: Vec.create(
      normal.x * cosine - normal.y * sine,
      normal.x * sine + normal.y * cosine,
    ),
    overlap,
  };
};

export class Asteroid extends GameObject {
  static friction = 0.2;
  static angularDrag = 0.15;
  contents: number[];
  decay?: number;
  health: number;
  kind = 'asteroid' as const;
  maxHealth: number;
  shapeOutline?: number[][];
  pointCount?: number;
  radiusEven?: number;
  resource?: number;
  segments?: AsteroidSegment[];

  constructor({
    contents,
    decay,
    health,
    maxHealth,
    shapeOutline,
    pointCount,
    radiusEven,
    resource,
    segments,
    ...properties
  }: ConstructorParameters<typeof GameObject>[0] & {
    contents: number[];
    decay?: number;
    health: number;
    maxHealth: number;
    shapeOutline?: number[][];
    pointCount?: number;
    radiusEven?: number;
    resource?: number;
    segments?: AsteroidSegment[];
  }) {
    super(properties);
    this.contents = [...contents];
    this.decay = decay;
    this.health = health;
    this.maxHealth = maxHealth;
    this.shapeOutline = shapeOutline?.map(([x, y]) => [x, y]);
    this.pointCount = pointCount;
    this.radiusEven = radiusEven;
    this.resource = resource;
    const validSegments = segments?.every(
      (asteroidSegment) =>
        asteroidSegment && Array.isArray(asteroidSegment.shapeOutline),
    )
      ? segments
      : undefined;

    this.segments = validSegments?.map((asteroidSegment) => ({
      ...asteroidSegment,
      contents: [...asteroidSegment.contents],
      shapeOutline: asteroidSegment.shapeOutline.map(([x, y]) => [x, y]),
    }));

    if (!shapeOutline && !validSegments) {
      this.segments = segmentsOf({
        contents,
        health,
        mass: this.mass,
        shapeOutline: shapeOutlineOf(this),
        radiusEven,
        random: createRandom(this.id + 1).next,
      });
    }

    if (this.segments?.length) {
      outerEdges(
        this.segments.map(
          (asteroidSegment) => asteroidSegment.shapeOutline as ShapeOutline,
        ),
      );
    }
  }

  hitbox(): Collider[] {
    // Cut faces already meet exactly; polygon padding would overlap siblings.
    if (this.segments?.length) {
      return this.segments.map((asteroidSegment) => ({
        bounciness: 0.2,
        collisionMargin: 0,
        shapeOutline: asteroidSegment.shapeOutline as ShapeOutline,
        owner: this,
        asteroidSegment,
        friction: this.friction,
        position: this.position,
        radius: this.radius,
        rotation: this.rotation,
      }));
    }

    const shapeOutline = shapeOutlineOf(this);
    const center = centerOf(shapeOutline);
    // Detached leaves get a tiny collision-only inset. Keep the render shape outline,
    // mass and resources intact, and never shrink the remaining asteroid.
    const collisionShapeOutline = shapeOutline.map(([x, y]) => {
      const offset = Vec.subtract(Vec.create(x, y), center);
      const point = Vec.addScaled(
        center,
        offset,
        Math.max(0.5, 1 - 0.1 / (Vec.length(offset) || 1)),
      );

      return [point.x, point.y];
    });

    return [
      {
        bounciness: 0.2,
        friction: this.friction,
        collisionMargin: 0,
        shapeOutline: collisionShapeOutline as ShapeOutline,
        owner: this,
        position: this.position,
        radius: this.radius,
        rotation: this.rotation,
      },
    ];
  }

  fracture({
    asteroidSegment,
    by,
    events,
    world,
  }: {
    asteroidSegment?: AsteroidSegment;
    by: number;
    events: SimulationEvent[];
    world: SimulationWorld;
  }) {
    if (this.dead) return false;

    if (this.health < 1) {
      this.remove();
      this.contents.forEach((resource) =>
        addEntity(
          world,
          new itemTypes[resource]({
            world,
            id: entityId(world),
            position: Vec.clone(this.position),
            velocity: Vec.clone(this.velocity),
          }),
        ),
      );
      events.push({
        type: 'asteroidDestroyed',
        asteroidId: this.id,
        by,
        contents: this.contents,
      });
    } else if (asteroidSegment && asteroidSegment.health < 1) {
      const children = this.detach({ asteroidSegment, world });

      events.push({
        type: 'asteroidSplit',
        asteroidId: this.id,
        childIds: children.map((child) => child.id),
      });
    } else return false;
    return true;
  }

  detach({
    asteroidSegment,
    world,
  }: {
    asteroidSegment: AsteroidSegment;
    world: SimulationWorld;
  }) {
    return detachSegment({ asteroid: this, asteroidSegment, world });
  }
}

export const createAsteroid = (
  world: SimulationWorld,
  {
    contents = [],
    decay,
    health,
    id = entityId(world),
    mass,
    maxHealth,
    shapeOutline,
    pointCount,
    position = Vec.create(),
    radius = 25,
    rotation = 0,
    spin = 0,
    radiusEven,
    resource,
    segments,
    velocity = Vec.create(),
  }: {
    contents?: number[];
    decay?: number;
    health?: number;
    id?: number;
    mass?: number;
    maxHealth?: number;
    shapeOutline?: number[][];
    pointCount?: number;
    position?: Vec.Value;
    radius?: number;
    rotation?: number;
    spin?: number;
    radiusEven?: number;
    resource?: number;
    segments?: AsteroidSegment[];
    velocity?: Vec.Value;
  } = {},
): Asteroid => {
  const fullHealth = maxHealth ?? health ?? radius * 2;

  return new Asteroid({
    contents,
    decay,
    health: health ?? fullHealth,
    id,
    mass: mass ?? 0.4 * radius ** 2,
    maxHealth: fullHealth,
    shapeOutline,
    pointCount,
    position,
    radius,
    radiusEven,
    resource,
    rotation,
    segments,
    spin,
    velocity,
  });
};
