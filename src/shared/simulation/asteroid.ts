import { Vector, type Vector as VectorValue } from '../vector';
import { rotatePoint } from '../geometry';
import { createPolygon, outerEdges, radiusOf } from '../polygon';
import { createRandom } from '../seeded-random';
import { type AsteroidSegment } from '../protocol/entities';
import { addEntity, type SimulationWorld, entityId } from './world';
import { GameObject } from '../game-object';
import { type Collider } from '../collision/types';
import { type Outline } from '../types';
import { itemTypes } from '../items';
import { type SimulationEvent } from '../protocol/events';

// Enough of a wander that no two asteroids come out the same shape
export const asteroidVariance = 0.2;

// Bigger asteroids need more points to be lumpy with
export const pointCountFor = (radius: number) =>
  Math.round(Math.sqrt(radius) * 0.3) * 2 - 1;

const outlines = new Map<string, number[][]>();

const withoutCollinearPoints = (outline: number[][]) =>
  outline.filter((point, index) => {
    const before = outline.at(index - 1)!;
    const next = outline[(index + 1) % outline.length];

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
export const outlineOf = (asteroid: Asteroid) => {
  if (asteroid.outline) return asteroid.outline;
  const key = [
    asteroid.id,
    asteroid.pointCount,
    asteroid.radius,
    asteroid.radiusEven,
  ].join(':');
  let outline = outlines.get(key);

  if (!outline) {
    const random = createRandom(asteroid.id);

    outline = createPolygon({
      pointCount: asteroid.pointCount || pointCountFor(asteroid.radius),
      radius: asteroid.radius,
      radiusEven: asteroid.radiusEven,
      random: random.next,
      variance: asteroidVariance,
    });
    // A long session flies past more rock than is worth remembering.

    if (outlines.size > 5000) outlines.clear();
    outlines.set(key, outline);
  }
  return withoutCollinearPoints(outline);
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
  outline,
  radiusEven,
  random,
}: {
  contents: number[];
  health: number;
  mass: number;
  outline: number[][];
  radiusEven?: number;
  random: () => number;
}) => {
  const inset = radiusEven && outline.filter((_, index) => !(index % 2));
  const triangles = inset
    ? [
        inset,
        ...inset.map((point, index) => [
          point,
          outline[index * 2 + 1],
          inset[(index + 1) % inset.length],
        ]),
      ]
    : outline[3]
      ? outline.map((point, index) => [
          [0, 0],
          point,
          outline[(index + 1) % outline.length],
        ])
      : [outline];
  const segmentsPerFace = inset ? 1 : 4;
  const leaves = triangles.map(
    inset ? (triangle) => [triangle] : splitTriangle,
  );
  const asteroidSegmentHealth = health / (triangles.length * segmentsPerFace);
  const asteroidSegmentMass = mass / (triangles.length * segmentsPerFace);
  // Match the original topology order: all centre leaves first, then the next
  // corner from every face. Cargo placement depends on that centre-first bias.
  const outlines = Array.from({ length: segmentsPerFace }, (_, corner) =>
    leaves.map((leaf) => leaf[corner]),
  ).flat();
  const segments: AsteroidSegment[] = outlines.map((asteroidSegment) => ({
    contents: [] as number[],
    health: asteroidSegmentHealth,
    mass: asteroidSegmentMass,
    maxHealth: asteroidSegmentHealth,
    outline: asteroidSegment.map(([x, y]) => [x, y]),
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
  outerEdges(segments.map(({ outline }) => outline as Outline)).map((indices) =>
    indices.map((index) => segments[index]),
  );

// groupsOf has already marked exterior edges on its connected groups.
const outlinesFromMarked = (segments: AsteroidSegment[]) => {
  const outer = segments.flatMap(({ outline }) => {
    const polygon = outline as Outline;

    return polygon.flatMap((from, index) =>
      polygon.edges?.[index]
        ? [{ from, to: polygon[(index + 1) % polygon.length] }]
        : [],
    );
  });
  const outlines: number[][][] = [];

  while (outer.length) {
    const first = outer.shift()!;
    const outline = [first.from];
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
      outline.push(at);
      edge = outer.splice(nextIndex, 1)[0];
    }
    outlines.push(withoutCollinearPoints(outline));
  }
  return outlines;
};

export const outlinesFrom = (segments: AsteroidSegment[]) => {
  outerEdges(segments.map(({ outline }) => outline as Outline));
  return outlinesFromMarked(segments);
};

export const centerOf = (outline: number[][]) => {
  let area = 0;
  let x = 0;
  let y = 0;

  outline.forEach(([atX, atY], index) => {
    const [nextX, nextY] = outline[(index + 1) % outline.length];
    const cross = atX * nextY - nextX * atY;

    area += cross;
    x += (atX + nextX) * cross;
    y += (atY + nextY) * cross;
  });
  return Vector(x / (area * 3), y / (area * 3));
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
    const outline =
      group.length === 1
        ? group[0].outline
        : outlinesFromMarked(group).reduce((largest, candidate) =>
            radiusOf(candidate) > radiusOf(largest) ? candidate : largest,
          );
    const center = centerOf(outline);
    const offset = rotatePoint(center, asteroid.rotation);
    const local = ([x, y]: number[]) => [x - center.x, y - center.y];
    const childOutline = outline.map(local);
    const childSegments = group.map((asteroidSegment) => ({
      ...asteroidSegment,
      contents: [...asteroidSegment.contents],
      outline: asteroidSegment.outline.map(local),
    }));
    const contents = group.flatMap(
      (asteroidSegment) => asteroidSegment.contents,
    );
    const mass = group.reduce(
      (sum, asteroidSegment) => sum + asteroidSegment.mass,
      0,
    );
    const radius = radiusOf(childOutline);
    const child = createAsteroid(world, {
      contents,
      decay: group.length === 1 && !contents.length ? 6 : undefined,
      health: radius,
      mass,
      maxHealth: radius,
      outline: childOutline,
      position: asteroid.position.add(offset),
      radius,
      resource: asteroid.resource,
      rotation: asteroid.rotation,
      segments: group.length > 1 ? childSegments : undefined,
      spin: asteroid.spin,
      velocity: asteroid.velocity.add(
        Vector(-offset.y, offset.x).scale(asteroid.spin),
      ),
    });

    return addEntity(world, child);
  });
  const force = 3 / children.reduce((sum, child) => sum + 1 / child.mass, 0);
  const spin = ((createRandom(asteroid.id).next() - 0.5) * force) / 3;

  children.forEach((child) => {
    child.velocity.set(
      child.velocity.add(
        child.position
          .subtract(asteroid.position)
          .normalize()
          .scale(force / child.mass),
      ),
    );
    child.spin += spin / child.mass;
  });
  return children;
};

/**
 * Whether a point lies within a shape cut radially about its own middle.
 */
const insideOutline = ({
  outline,
  local,
}: {
  outline: number[][];
  local: VectorValue;
}) => {
  const count = outline.length;
  const turn = Math.atan2(local.y, local.x) / (Math.PI * 2);
  const face = Math.floor((((turn % 1) + 1) % 1) * count);
  const [x, y] = outline[face];
  const [toX, toY] = outline[(face + 1) % count];
  // How far out the face between those two points sits, as a multiple of how
  // far out the point itself is.
  const across = local.x * (toY - y) - local.y * (toX - x);

  return !across || (x * toY - y * toX) / across > 1;
};

/**
 * Where a round body meets an asteroid's outline, rather than the circle that
 * only bounds it: the normal points out of the rock, towards the body.
 */
export const asteroidContact = ({
  asteroid,
  position,
  radius,
}: {
  asteroid: Asteroid;
  position: VectorValue;
  radius: number;
}) => {
  const outline = outlineOf(asteroid);
  const offset = position.subtract(asteroid.position);
  const cosine = Math.cos(asteroid.rotation);
  const sine = Math.sin(asteroid.rotation);
  // The outline is cut in the asteroid's own frame, so the body comes to it.
  const local = Vector(
    offset.x * cosine + offset.y * sine,
    offset.y * cosine - offset.x * sine,
  );
  let closest = local;
  let nearest = Infinity;

  outline.forEach(([x, y], i) => {
    const [toX, toY] = outline[(i + 1) % outline.length];
    const edge = Vector(toX - x, toY - y);
    const along = Math.min(
      1,
      Math.max(
        0,
        Vector(local.x - x, local.y - y).dot(edge) / (edge.dot(edge) || 1),
      ),
    );
    const point = Vector(x + edge.x * along, y + edge.y * along);
    const distance = point.distanceTo(local);

    if (distance < nearest) {
      nearest = distance;
      closest = point;
    }
  });

  const inside = insideOutline({ outline, local });
  const overlap = inside ? radius + nearest : radius - nearest;

  if (overlap <= 0) return;

  const away = inside ? closest.subtract(local) : local.subtract(closest);
  const normal = away.length() ? away.normalize() : Vector(1, 0);

  return {
    // Back out into the world the body is actually moving through.
    normal: Vector(
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
  outline?: number[][];
  pointCount?: number;
  radiusEven?: number;
  resource?: number;
  segments?: AsteroidSegment[];

  constructor({
    contents,
    decay,
    health,
    maxHealth,
    outline,
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
    outline?: number[][];
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
    this.outline = outline?.map(([x, y]) => [x, y]);
    this.pointCount = pointCount;
    this.radiusEven = radiusEven;
    this.resource = resource;
    const validSegments = segments?.every(
      (asteroidSegment) =>
        asteroidSegment && Array.isArray(asteroidSegment.outline),
    )
      ? segments
      : undefined;

    this.segments = validSegments?.map((asteroidSegment) => ({
      ...asteroidSegment,
      contents: [...asteroidSegment.contents],
      outline: asteroidSegment.outline.map(([x, y]) => [x, y]),
    }));

    if (!outline && !validSegments) {
      this.segments = segmentsOf({
        contents,
        health,
        mass: this.mass,
        outline: outlineOf(this),
        radiusEven,
        random: createRandom(this.id + 1).next,
      });
    }

    if (this.segments?.length) {
      outerEdges(
        this.segments.map(
          (asteroidSegment) => asteroidSegment.outline as Outline,
        ),
      );
    }
  }

  hitbox(): Collider[] {
    // Cut faces already meet exactly; polygon padding would overlap siblings.
    const colliders = this.segments?.map((asteroidSegment) => ({
      collisionMargin: 0,
      outline: asteroidSegment.outline as Outline,
      owner: this,
      asteroidSegment,
      friction: this.friction,
      position: this.position,
      radius: this.radius,
      rotation: this.rotation,
    }));

    const outline = outlineOf(this);
    const center = !colliders?.length && centerOf(outline);
    // Detached leaves get a tiny collision-only inset. Keep the render outline,
    // mass and resources intact, and never shrink the remaining asteroid.
    const collisionOutline = center
      ? outline.map(([x, y]) => {
          const offset = Vector(x, y).subtract(center);
          const point = center.add(
            offset.scale(Math.max(0.5, 1 - 0.1 / (offset.length() || 1))),
          );

          return [point.x, point.y];
        })
      : outline;

    return [
      Object.assign(
        {
          bounciness: 0.2,
          friction: this.friction,
          collisionMargin: 0,
          outline: collisionOutline as Outline,
          owner: this,
          position: this.position,
          radius: this.radius,
          rotation: this.rotation,
        },
        colliders?.length && { colliders },
      ),
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
            position: this.position.add(Vector()),
            velocity: this.velocity.add(Vector()),
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
    outline,
    pointCount,
    position = Vector(),
    radius = 25,
    rotation = 0,
    spin = 0,
    radiusEven,
    resource,
    segments,
    velocity = Vector(),
  }: {
    contents?: number[];
    decay?: number;
    health?: number;
    id?: number;
    mass?: number;
    maxHealth?: number;
    outline?: number[][];
    pointCount?: number;
    position?: VectorValue;
    radius?: number;
    rotation?: number;
    spin?: number;
    radiusEven?: number;
    resource?: number;
    segments?: AsteroidSegment[];
    velocity?: VectorValue;
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
    outline,
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
