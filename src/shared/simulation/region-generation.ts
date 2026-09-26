import * as Vec from '../vector';
import {
  type AsteroidDescription,
  type RegionDescription,
  type StationDescription,
  type WreckDescription,
} from '../protocol/regions';
import { createRandom, type Random } from '../seeded-random';
import { regionSize } from '../settings';
import { round } from '../utilities/round';

const mix = (value: number) => {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
};

/**
 * Derive one region's seed without depending on generation order.
 */
export const regionSeed = ({
  worldSeed,
  region,
}: {
  worldSeed: number;
  region: Vec.Value;
}) => mix(worldSeed ^ mix(region.x) ^ mix(region.y + 0x9e3779b9));

const descriptionId = ({
  seed,
  kind,
  index,
}: {
  seed: number;
  kind: number;
  index: number;
}) => mix(seed ^ Math.imul(kind, 0x9e3779b9) ^ index) || 1;

const randomPosition = ({
  random,
  cell,
  size,
}: {
  random: Random;
  cell: Vec.Value;
  size: number;
}) =>
  Vec.create(
    Math.round((cell.x + random.next()) * size),
    Math.round((cell.y + random.next()) * size),
  );

const randomSpin = ({ random }: { random: Random }) =>
  round(((random.next() < 0.5 ? -1 : 1) * (1 + random.next())) / 40);

const randomResource = ({ random }: { random: Random }) =>
  3 - Math.floor(random.next() ** 3 * 4);

type Field = {
  id: number;
  position: Vec.Value;
  radius: number;
  resource: number;
};

type WreckCandidate = Omit<WreckDescription, 'clueField'>;
type Feature = Field | StationDescription | WreckCandidate;
type RegionCandidates = Omit<RegionDescription, 'wrecks'> & {
  wrecks: WreckCandidate[];
};

const fieldFeature = 0;
const stationFeature = 1;
const wreckFeature = 2;

type FeatureKind =
  | typeof fieldFeature
  | typeof stationFeature
  | typeof wreckFeature;

// The old world used 8000 m station, 5500 m wreck, and 350 m field clearance.
// Spatial cells make those distances work without a finite world boundary.
const featureSettings = [
  { size: 6000, chance: 0.72, clearance: 350, kind: 4 },
  { size: 10000, chance: 0.32, clearance: 8000, kind: 2 },
  { size: 10000, chance: 0.5, clearance: 5500, kind: 3 },
];

const featureCandidate = ({
  worldSeed,
  cell,
  kind,
}: {
  worldSeed: number;
  cell: Vec.Value;
  kind: FeatureKind;
}): Feature | undefined => {
  const settings = featureSettings[kind];
  const seed = regionSeed({ worldSeed, region: cell });
  // Separate station samples keep seed 25 near its historical starting station.
  const stream = kind === stationFeature ? 9 : 0;
  const random = createRandom(
    descriptionId({ seed, kind: settings.kind, index: stream }),
  );

  if (random.next() >= settings.chance) return;

  const position = randomPosition({ random, cell, size: settings.size });
  const id = descriptionId({ seed, kind: settings.kind, index: 1 });

  if (kind === fieldFeature) {
    const roll = random.next();
    const resource = roll < 0.06 ? 1 : roll < 0.18 ? 2 : 4;
    const radius = (2000 + random.next() * 2000) / (resource === 1 ? 2 : 1);

    return { id, position, radius, resource };
  }

  if (kind === stationFeature) {
    return {
      id,
      position,
      radius: 400,
      spin: randomSpin({ random }),
      type: 'station',
    };
  }

  return {
    cargoContents: Array.from(
      { length: 2 + Math.floor(random.next() * 3) },
      () => Math.floor(random.next() * 4),
    ),
    id,
    paint:
      random.next() < 2 / 3 ? 1 : [0, 2, 3, 4][Math.floor(random.next() * 4)],
    position,
    radius: 100,
    spin: randomSpin({ random }),
    type: 'wreck',
  };
};

const spacingRadius = (feature: Feature, kind: FeatureKind) =>
  kind === fieldFeature ? feature.radius * 0.7 : feature.radius;

const acceptedFeature = ({
  worldSeed,
  cell,
  kind,
}: {
  worldSeed: number;
  cell: Vec.Value;
  kind: FeatureKind;
}): Feature | undefined => {
  const candidate = featureCandidate({ worldSeed, cell, kind });

  if (!candidate) return;

  const crowded = [-1, 0, 1].some((y) =>
    [-1, 0, 1].some((x) => {
      if (!x && !y) return false;

      const other = featureCandidate({
        worldSeed,
        cell: Vec.create(cell.x + x, cell.y + y),
        kind,
      });

      return (
        other &&
        other.id < candidate.id &&
        Vec.distance(other.position, candidate.position) <
          spacingRadius(other, kind) +
            spacingRadius(candidate, kind) +
            featureSettings[kind].clearance
      );
    }),
  );

  return crowded ? undefined : candidate;
};

const featuresWithin = ({
  worldSeed,
  from,
  to,
  kind,
}: {
  worldSeed: number;
  from: Vec.Value;
  to: Vec.Value;
  kind: FeatureKind;
}) => {
  const size = featureSettings[kind].size;
  const features: Feature[] = [];

  for (let x = Math.floor(from.x / size); x <= Math.floor(to.x / size); x++) {
    for (let y = Math.floor(from.y / size); y <= Math.floor(to.y / size); y++) {
      const feature = acceptedFeature({
        worldSeed,
        cell: Vec.create(x, y),
        kind,
      });

      if (
        feature &&
        feature.position.x >= from.x &&
        feature.position.x < to.x &&
        feature.position.y >= from.y &&
        feature.position.y < to.y
      ) {
        features.push(feature);
      }
    }
  }

  return features;
};

/**
 * Expose the field outlines to the world preview without storing them in regions.
 */
export const generateFields = ({
  worldSeed,
  from,
  to,
}: {
  worldSeed: number;
  from: Vec.Value;
  to: Vec.Value;
}) => featuresWithin({ worldSeed, from, to, kind: fieldFeature }) as Field[];

export const fieldMessage = ({
  position,
  resource,
}: {
  position: Vec.Value;
  resource: number;
}) =>
  `${resource === 1 ? 'AMETHYST CLUSTER' : 'GOLD ORE'} ${position.x}/${position.y}`;

/**
 * Search farther until the square contains every field closer than our best.
 */
const nearestRichField = ({
  worldSeed,
  position,
}: {
  worldSeed: number;
  position: Vec.Value;
}): Field => {
  let range = 20000;

  for (;;) {
    const richFields = generateFields({
      worldSeed,
      from: Vec.add(position, Vec.create(-range, -range)),
      to: Vec.add(position, Vec.create(range, range)),
    }).filter(({ resource }) => resource < 3);
    const nearest = richFields.reduce<Field | undefined>(
      (closest, field) =>
        !closest ||
        Vec.distance(field.position, position) <
          Vec.distance(closest.position, position)
          ? field
          : closest,
      undefined,
    );

    if (nearest && Vec.distance(nearest.position, position) <= range) {
      return nearest;
    }
    range *= 2;
  }
};

const makeAsteroid = ({
  seed,
  index,
  random,
  region,
  resource,
}: {
  seed: number;
  index: number;
  random: Random;
  region: Vec.Value;
  resource: number;
}): AsteroidDescription => {
  const spikes = resource === 1;
  const gold = resource === 2;
  const radius = round(
    50 +
      (spikes
        ? 50 + random.next() * 2
        : gold
          ? 110 + random.next() * 60
          : 1.25 + random.next() * 120),
  );
  const capacity = Math.round((radius / 50) ** 2);
  const itemCount =
    random.next() < (resource > 3 ? 0.3 : capacity / (capacity + 1))
      ? spikes
        ? 1
        : 1 + Math.floor(random.next() * capacity)
      : 0;

  const contents = Array.from({ length: itemCount }, () =>
    resource > 3 ? randomResource({ random }) : resource,
  );

  // Keep the rich fields full, but avoid overcrowding mixed rocks.
  if (resource > 3) contents.length = Math.min(contents.length, 6);

  const position = randomPosition({ random, cell: region, size: regionSize });

  return {
    contents,
    id: descriptionId({ seed, kind: 1, index }),
    ...(spikes && { pointCount: 6, radiusEven: round(radius / 4) }),
    position,
    radius,
    resource,
    rotation: round(random.next() * Math.PI * 2),
    spin: randomSpin({ random }),
    type: 'asteroid',
  };
};

const generateCandidates = ({
  worldSeed,
  region,
}: {
  worldSeed: number;
  region: Vec.Value;
}): RegionCandidates => {
  const from = Vec.scale(region, regionSize);
  const to = Vec.add(from, Vec.create(regionSize, regionSize));
  const stations = featuresWithin({
    worldSeed,
    from,
    to,
    kind: stationFeature,
  }) as StationDescription[];
  const wrecks = featuresWithin({
    worldSeed,
    from,
    to,
    kind: wreckFeature,
  }) as WreckCandidate[];
  const fields = generateFields({
    worldSeed,
    from: Vec.add(from, Vec.create(-4000, -4000)),
    to: Vec.add(to, Vec.create(4000, 4000)),
  });
  const asteroids = fields.flatMap((field) => {
    const seed = mix(regionSeed({ worldSeed, region }) ^ field.id);
    const random = createRandom(seed);
    // Rich gold fields stay sparser; small amethyst pockets hold short spikes.
    const count = field.resource === 1 ? 45 : field.resource === 2 ? 65 : 75;

    return Array.from({ length: count }, (_, index) =>
      makeAsteroid({ seed, index, random, region, resource: field.resource }),
    ).filter(
      (asteroid) =>
        Vec.distance(asteroid.position, field.position) <
        field.radius - asteroid.radius,
    );
  });

  return { asteroids, region: Vec.clone(region), stations, wrecks };
};

// The old world distributor left this much clear space beyond both radii.
export const asteroidSpacing = 30;

// Reject crowded candidates in a stable order, independent of region load order.
export const generateRegion = ({
  worldSeed,
  region,
}: {
  worldSeed: number;
  region: Vec.Value;
}): RegionDescription => {
  const current = generateCandidates({ worldSeed, region });
  const nearby = [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].map((x) =>
      x || y
        ? generateCandidates({
            worldSeed,
            region: Vec.create(region.x + x, region.y + y),
          })
        : current,
    ),
  );
  const obstacles = nearby.flatMap(({ stations, wrecks }) => [
    ...stations,
    ...wrecks,
  ]);
  const overlaps = (
    asteroid: AsteroidDescription,
    other: { position: Vec.Value; radius: number },
  ) =>
    Vec.distance(asteroid.position, other.position) <
    asteroid.radius + other.radius + asteroidSpacing;
  const candidates = nearby
    .flatMap(({ asteroids }) => asteroids)
    .filter(
      (asteroid) => !obstacles.some((other) => overlaps(asteroid, other)),
    );
  const candidateSet = new Set(candidates);
  // An overlapping pair can occupy only the same or adjacent grid cells.
  const cellSize =
    2 * Math.max(0, ...candidates.map(({ radius }) => radius)) +
    asteroidSpacing;
  const cell = ({ position }: AsteroidDescription) =>
    Vec.create(
      Math.floor(position.x / cellSize),
      Math.floor(position.y / cellSize),
    );
  const buckets = new Map<string, AsteroidDescription[]>();

  candidates.forEach((asteroid) => {
    const { x, y } = cell(asteroid);
    const key = `${x},${y}`;
    const bucket = buckets.get(key) || [];

    bucket.push(asteroid);
    buckets.set(key, bucket);
  });

  return {
    ...current,
    wrecks: current.wrecks.map((wreck) => {
      const clueField = nearestRichField({
        worldSeed,
        position: wreck.position,
      });

      return {
        ...wreck,
        cargoContents: wreck.cargoContents.map(() => clueField.resource),
        clueField,
      };
    }),
    asteroids: current.asteroids.filter((asteroid) => {
      if (!candidateSet.has(asteroid)) return false;

      const { x, y } = cell(asteroid);

      return ![-1, 0, 1].some((dy) =>
        [-1, 0, 1].some((dx) =>
          (buckets.get(`${x + dx},${y + dy}`) || []).some(
            (other) => other.id < asteroid.id && overlaps(asteroid, other),
          ),
        ),
      );
    }),
  };
};
