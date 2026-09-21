import { Vector, type Vector as VectorValue } from '../vector';
import { createPolygon, radiusOf } from '../polygon';
import { createRandom } from '../seeded-random';
import { type AsteroidSection } from '../protocol/entities';
import { addEntity, type SimulationWorld, entityId } from './world';
import { GameObject } from '../game-object';
import { type Collider, type Outline } from './physics';
import { outerEdges } from './collisions';

// Enough of a wander that no two asteroids come out the same shape
export const asteroidVariance = 0.2;

// Bigger asteroids need more points to be lumpy with
export const pointsFor = (radius: number) =>
  Math.round(Math.sqrt(radius) * 0.3) * 2 - 1;

const outlines = new Map<string, number[][]>();

/**
 * The shape an asteroid is actually cut to. Every copy of one, on any client
 * and on the server, is cut from its own id, so they all agree on it without
 * it ever going over the wire.
 */
export const outlineOf = (asteroid: Asteroid) => {
  if (asteroid.outline) return asteroid.outline;
  const key = [
    asteroid.id,
    asteroid.points,
    asteroid.radius,
    asteroid.radiusEven,
  ].join(':');
  let outline = outlines.get(key);

  if (!outline) {
    const random = createRandom(asteroid.id);

    outline = createPolygon({
      points: asteroid.points || pointsFor(asteroid.radius),
      radius: asteroid.radius,
      radiusEven: asteroid.radiusEven,
      random: random.next,
      variance: asteroidVariance,
    });
    // A long session flies past more rock than is worth remembering.
    if (outlines.size > 5000) outlines.clear();
    outlines.set(key, outline);
  }
  return outline.filter((point, index) => {
    const before = outline.at(index - 1)!;
    const next = outline[(index + 1) % outline.length];

    return (
      (point[0] - before[0]) * (next[1] - point[1]) !==
      (point[1] - before[1]) * (next[0] - point[0])
    );
  });
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

const sectionsOf = ({
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
  const sectionsPerFace = inset ? 1 : 4;
  const leaves = triangles.map(
    inset ? (triangle) => [triangle] : splitTriangle,
  );
  const sectionHealth = health / (triangles.length * sectionsPerFace);
  const sectionMass = mass / (triangles.length * sectionsPerFace);
  // Match the original topology order: all centre leaves first, then the next
  // corner from every face. Cargo placement depends on that centre-first bias.
  const outlines = Array.from({ length: sectionsPerFace }, (_, corner) =>
    leaves.map((leaf) => leaf[corner]),
  ).flat();
  const sections: AsteroidSection[] = outlines.map((section) => ({
    contents: [] as number[],
    health: sectionHealth,
    mass: sectionMass,
    maxHealth: sectionHealth,
    outline: section.map(([x, y]) => [x, y]),
  }));
  const empty = [...sections];

  contents.forEach((resource) => {
    const index = Math.floor(random() ** 2 * empty.length);

    (empty.splice(index, 1)[0] || sections[0]).contents.push(resource);
  });
  return sections;
};

const samePoint = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];

const sharesEdge = (a: AsteroidSection, b: AsteroidSection) =>
  a.outline.some((from, index) => {
    const to = a.outline[(index + 1) % a.outline.length];

    return b.outline.some((otherFrom, otherIndex) => {
      const otherTo = b.outline[(otherIndex + 1) % b.outline.length];

      return (
        (samePoint(from, otherFrom) && samePoint(to, otherTo)) ||
        (samePoint(from, otherTo) && samePoint(to, otherFrom))
      );
    });
  });

const groupsOf = (sections: AsteroidSection[]) => {
  const left = [...sections];
  const groups: AsteroidSection[][] = [];

  while (left.length) {
    const group = [left.pop()!];

    for (let index = 0; index < group.length; index++)
      for (let candidate = left.length; candidate--;)
        if (sharesEdge(group[index], left[candidate]))
          group.push(left.splice(candidate, 1)[0]);
    groups.push(group);
  }
  return groups;
};

const outlineFrom = (sections: AsteroidSection[]) => {
  const edges = sections.flatMap(({ outline }) =>
    outline.map((from, index) => ({
      from,
      to: outline[(index + 1) % outline.length],
    })),
  );
  const outer = edges.filter(
    ({ from, to }) =>
      edges.filter(
        (edge) =>
          (samePoint(from, edge.from) && samePoint(to, edge.to)) ||
          (samePoint(from, edge.to) && samePoint(to, edge.from)),
      ).length === 1,
  );
  const first = outer.shift()!;
  const outline = [first.from, first.to];

  while (outer.length) {
    const at = outline.at(-1)!;
    const index = outer.findIndex(
      ({ from, to }) => samePoint(from, at) || samePoint(to, at),
    );

    if (index < 0) break;
    const edge = outer.splice(index, 1)[0];
    const next = samePoint(edge.from, at) ? edge.to : edge.from;

    if (samePoint(next, outline[0])) break;
    outline.push(next);
  }
  return outline.filter((point, index) => {
    const before = outline.at(index - 1)!;
    const next = outline[(index + 1) % outline.length];
    return (
      (point[0] - before[0]) * (next[1] - point[1]) !==
      (point[1] - before[1]) * (next[0] - point[0])
    );
  });
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

const detachSection = ({
  asteroid,
  section,
  world,
}: {
  asteroid: Asteroid;
  section: AsteroidSection;
  world: SimulationWorld;
}) => {
  const remaining = asteroid.sections!.filter(
    (candidate) => candidate !== section,
  );
  const groups = [[section], ...groupsOf(remaining)];

  asteroid.remove();
  const children = groups.map((group) => {
    const outline = outlineFrom(group);
    const center = centerOf(outline);
    const cosine = Math.cos(asteroid.rotation);
    const sine = Math.sin(asteroid.rotation);
    const offset = Vector(
      center.x * cosine - center.y * sine,
      center.x * sine + center.y * cosine,
    );
    const local = ([x, y]: number[]) => [x - center.x, y - center.y];
    const childOutline = outline.map(local);
    const childSections = group.map((part) => ({
      ...part,
      contents: [...part.contents],
      outline: part.outline.map(local),
    }));
    const contents = group.flatMap((part) => part.contents);
    const mass = group.reduce((sum, part) => sum + part.mass, 0);
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
      sections: group.length > 1 ? childSections : undefined,
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

/** Whether a point lies within a shape cut radially about its own middle. */
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
  contents: number[];
  decay?: number;
  health: number;
  kind = 'asteroid' as const;
  maxHealth: number;
  outline?: number[][];
  points?: number;
  radiusEven?: number;
  resource?: number;
  sections?: AsteroidSection[];

  constructor({
    contents,
    decay,
    health,
    maxHealth,
    outline,
    points,
    radiusEven,
    resource,
    sections,
    ...properties
  }: ConstructorParameters<typeof GameObject>[0] & {
    contents: number[];
    decay?: number;
    health: number;
    maxHealth: number;
    outline?: number[][];
    points?: number;
    radiusEven?: number;
    resource?: number;
    sections?: AsteroidSection[];
  }) {
    super(properties);
    this.contents = [...contents];
    this.decay = decay;
    this.health = health;
    this.maxHealth = maxHealth;
    this.outline = outline?.map(([x, y]) => [x, y]);
    this.points = points;
    this.radiusEven = radiusEven;
    this.resource = resource;
    const validSections = sections?.every(
      (section) => section && Array.isArray(section.outline),
    )
      ? sections
      : undefined;

    this.sections = validSections?.map((section) => ({
      ...section,
      contents: [...section.contents],
      outline: section.outline.map(([x, y]) => [x, y]),
    }));

    if (!outline && !validSections)
      this.sections = sectionsOf({
        contents,
        health,
        mass: this.mass,
        outline: outlineOf(this),
        radiusEven,
        random: createRandom(this.id + 1).next,
      });
    if (this.sections?.length)
      outerEdges(this.sections.map((section) => section.outline as Outline));
  }

  hitboxes(): Collider[] {
    const parts = this.sections?.map((section) => ({
      outline: section.outline as Outline,
      owner: this,
      part: section,
      position: this.position,
      radius: this.radius,
      rotation: this.rotation,
    }));

    return [
      Object.assign(
        {
          bounciness: 0.1,
          outline: outlineOf(this) as Outline,
          owner: this,
          position: this.position,
          radius: this.radius,
          rotation: this.rotation,
        },
        parts?.length && { parts },
      ),
    ];
  }

  detach({
    section,
    world,
  }: {
    section: AsteroidSection;
    world: SimulationWorld;
  }) {
    return detachSection({ asteroid: this, section, world });
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
    points,
    position = Vector(),
    radius = 25,
    rotation = 0,
    spin = 0,
    radiusEven,
    resource,
    sections,
    velocity = Vector(),
  }: {
    contents?: number[];
    decay?: number;
    health?: number;
    id?: number;
    mass?: number;
    maxHealth?: number;
    outline?: number[][];
    points?: number;
    position?: VectorValue;
    radius?: number;
    rotation?: number;
    spin?: number;
    radiusEven?: number;
    resource?: number;
    sections?: AsteroidSection[];
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
    points,
    position,
    radius,
    radiusEven,
    resource,
    rotation,
    sections,
    spin,
    velocity,
  });
};
