import * as Vec from '../utilities/vector';
import {
  type AsteroidDescription,
  type RegionDescription,
  type StationDescription,
  type WreckDescription,
} from '../protocol/regions';
import { createRandom, type Random } from '../utilities/seeded-random';
import { regionSize } from '../../specs/region-manager';
import { round } from '../utilities/round';
import { regionGeneration as specification } from '../../specs/region-generation';

import { mixSeed as mix } from '../utilities/seed-hash';
import { sectorDensity, type Sector } from './sector-generation';
import { sectorGeneration } from '../../specs/sectors';

/**
 * Derive one region's seed without depending on generation order.
 */
export const regionSeed = ({
  worldSeed,
  sector,
  region,
}: {
  worldSeed: number;
  sector?: Sector;
  region: Vec.Value;
}) =>
  mix((sector?.seed ?? worldSeed) ^ mix(region.x) ^ mix(region.y + 0x9e3779b9));

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
const featureSettings = specification.features;

const featureCandidate = ({
  worldSeed,
  sector,
  cell,
  kind,
}: {
  worldSeed: number;
  sector?: Sector;
  cell: Vec.Value;
  kind: FeatureKind;
}): Feature | undefined => {
  if (sector && kind === stationFeature && !sector.gateSites.length) return;

  const settings = featureSettings[kind];
  const seed = regionSeed({ worldSeed, sector, region: cell });
  // Separate station samples keep seed 25 near its historical starting station.
  const stream = kind === stationFeature ? specification.stationStream : 0;
  const random = createRandom(
    descriptionId({ seed, kind: settings.kind, index: stream }),
  );

  const chance = random.next();

  if (
    chance >=
    settings.chance * (sector ? sectorGeneration.density[kind].peak : 1)
  ) {
    return;
  }

  const position = randomPosition({ random, cell, size: settings.size });

  if (
    sector &&
    chance >= settings.chance * sectorDensity({ sector, position, kind })
  ) {
    return;
  }

  if (
    sector &&
    kind !== fieldFeature &&
    [...sector.gateSites, ...sector.wormholeSites].some(
      (site) =>
        Vec.distance(site.position, position) <
        sectorGeneration.gateArrivalDistance +
          sectorGeneration.gateClearance +
          (kind === stationFeature
            ? specification.stationRadius
            : specification.wreckRadius),
    )
  ) {
    return;
  }

  const id = descriptionId({ seed, kind: settings.kind, index: 1 });

  if (kind === fieldFeature) {
    const roll = random.next();
    const resource =
      roll < specification.richFieldAmethystChance
        ? 1
        : roll < specification.richFieldGoldChance
          ? 2
          : 4;
    const radius =
      (specification.fieldRadius +
        random.next() * specification.fieldRadiusRange) /
      (resource === 1 ? 2 : 1);

    return { id, position, radius, resource };
  }

  if (kind === stationFeature) {
    return {
      id,
      position,
      radius: specification.stationRadius,
      spin: randomSpin({ random }),
      definitionId: random.next() < 0.5 ? 'corral-5' : 'corral-6',
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
    radius: specification.wreckRadius,
    spin: randomSpin({ random }),
    type: 'wreck',
  };
};

const spacingRadius = (feature: Feature, kind: FeatureKind) =>
  kind === fieldFeature ? feature.radius * 0.7 : feature.radius;

const acceptedFeature = ({
  worldSeed,
  sector,
  cell,
  kind,
}: {
  worldSeed: number;
  sector?: Sector;
  cell: Vec.Value;
  kind: FeatureKind;
}): Feature | undefined => {
  const candidate = featureCandidate({ worldSeed, sector, cell, kind });

  if (!candidate) return;

  const crowded = [-1, 0, 1].some((y) =>
    [-1, 0, 1].some((x) => {
      if (!x && !y) return false;

      const other = featureCandidate({
        worldSeed,
        sector,
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

type FeatureBounds = {
  worldSeed: number;
  sector?: Sector;
  from: Vec.Value;
  to: Vec.Value;
};

const featuresWithin = ({
  worldSeed,
  sector,
  from,
  to,
  kind,
}: FeatureBounds & { kind: FeatureKind }) => {
  const size = featureSettings[kind].size;
  const features: Feature[] = [];

  for (let x = Math.floor(from.x / size); x <= Math.floor(to.x / size); x++) {
    for (let y = Math.floor(from.y / size); y <= Math.floor(to.y / size); y++) {
      const feature = acceptedFeature({
        worldSeed,
        sector,
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

export const generateStations = (options: FeatureBounds) =>
  featuresWithin({ ...options, kind: stationFeature }) as StationDescription[];

export const generateWrecks = (options: FeatureBounds) =>
  featuresWithin({ ...options, kind: wreckFeature }) as WreckCandidate[];

/**
 * Expose the field outlines to the world preview without storing them in regions.
 */
export const generateFields = (options: FeatureBounds) =>
  featuresWithin({ ...options, kind: fieldFeature }) as Field[];

export const fieldMessage = ({
  position,
  resource,
  sectorName,
}: {
  position: Vec.Value;
  resource: number;
  sectorName?: string;
}) =>
  `${sectorName ? `${sectorName} / ` : ''}${resource === 1 ? 'AMETHYST CLUSTER' : 'GOLD ORE'} ${position.x}/${position.y}`;

/**
 * Bound clue searches; distant wrecks can retain ordinary cargo without a clue.
 */
const nearestRichField = ({
  worldSeed,
  sector,
  position,
}: {
  worldSeed: number;
  sector?: Sector;
  position: Vec.Value;
}): Field | undefined => {
  let range: number = specification.nearestFieldInitialRange;

  for (;;) {
    const richFields = generateFields({
      worldSeed,
      sector,
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

    if (range >= sectorGeneration.richFieldSearchRange) return nearest;
    range = Math.min(range * 2, sectorGeneration.richFieldSearchRange);
  }
};

export const makeAsteroid = ({
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
    specification.asteroidBaseRadius +
      (spikes
        ? specification.asteroidAmethystRadius +
          random.next() * specification.asteroidAmethystRange
        : gold
          ? specification.asteroidGoldRadius +
            random.next() * specification.asteroidGoldRange
          : specification.asteroidMixedRadius +
            random.next() * specification.asteroidMixedRange),
  );
  const capacity = Math.round((radius / 50) ** 2);
  const itemCount =
    random.next() <
    (resource > 3 ? specification.mixedItemChance : capacity / (capacity + 1))
      ? spikes
        ? 1
        : 1 + Math.floor(random.next() * capacity)
      : 0;

  const contents = Array.from({ length: itemCount }, () =>
    resource > 3 ? randomResource({ random }) : resource,
  );

  // Keep the rich fields full, but avoid overcrowding mixed rocks.
  if (resource > 3) {
    contents.length = Math.min(contents.length, specification.mixedItemLimit);
  }

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

// Adjacent region loads repeatedly inspect the same nine candidate regions.
// Keep a bounded immutable source cache; generateRegion returns a detached copy.
const candidateRegions = new Map<string, RegionCandidates>();

const generateCandidates = ({
  worldSeed,
  sector,
  region,
}: {
  worldSeed: number;
  sector?: Sector;
  region: Vec.Value;
}): RegionCandidates => {
  const key = `${worldSeed}:${sector ? JSON.stringify(sector) : ''}:${region.x},${region.y}`;
  const cached = candidateRegions.get(key);

  if (cached) return cached;
  const from = Vec.scale(region, regionSize);
  const to = Vec.add(from, Vec.create(regionSize, regionSize));

  const stations = featuresWithin({
    worldSeed,
    sector,
    from,
    to,
    kind: stationFeature,
  }) as StationDescription[];

  const wrecks = featuresWithin({
    worldSeed,
    sector,
    from,
    to,
    kind: wreckFeature,
  }) as WreckCandidate[];

  const fields = generateFields({
    worldSeed,
    sector,
    from: Vec.add(
      from,
      Vec.create(
        -specification.fieldSearchMargin,
        -specification.fieldSearchMargin,
      ),
    ),
    to: Vec.add(
      to,
      Vec.create(
        specification.fieldSearchMargin,
        specification.fieldSearchMargin,
      ),
    ),
  });

  const asteroids = fields.flatMap((field) => {
    const seed = mix(regionSeed({ worldSeed, sector, region }) ^ field.id);
    const random = createRandom(seed);
    // Rich gold fields stay sparser; small amethyst pockets hold short spikes.
    const count =
      field.resource === 1
        ? specification.asteroidCounts.amethyst
        : field.resource === 2
          ? specification.asteroidCounts.gold
          : specification.asteroidCounts.mixed;

    return Array.from({ length: count }, (_, index) =>
      makeAsteroid({ seed, index, random, region, resource: field.resource }),
    ).filter(
      (asteroid) =>
        Vec.distance(asteroid.position, field.position) <
        field.radius - asteroid.radius,
    );
  });

  const candidates = { asteroids, region: Vec.clone(region), stations, wrecks };

  candidateRegions.set(key, candidates);

  if (candidateRegions.size > 1024) {
    for (const oldest of candidateRegions.keys()) {
      candidateRegions.delete(oldest);
      break;
    }
  }

  return candidates;
};

// Polygon variance is inward-only; this clearance beyond both full radii
// also covers coordinate rounding, so rotation cannot close the gap.
export const asteroidSpacing = specification.asteroidSpacing;

// Reject crowded candidates in a stable order, independent of region load order.
export const generateRegion = ({
  worldSeed,
  sector,
  region,
}: {
  worldSeed: number;
  sector?: Sector;
  region: Vec.Value;
}): RegionDescription => {
  const current = generateCandidates({ worldSeed, sector, region });

  const nearby = [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].map((x) =>
      x || y
        ? generateCandidates({
            worldSeed,
            sector,
            region: Vec.create(region.x + x, region.y + y),
          })
        : current,
    ),
  );

  const obstacles: { position: Vec.Value; radius: number }[] = nearby.flatMap(
    ({ stations, wrecks }) => [...stations, ...wrecks],
  );

  if (sector) {
    obstacles.push(
      ...[...sector.gateSites, ...sector.wormholeSites].map((site) => ({
        ...site,
        radius:
          sectorGeneration.gateArrivalDistance + sectorGeneration.gateClearance,
      })),
    );
  }

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

  return structuredClone({
    ...current,
    wrecks: current.wrecks.map((wreck) => {
      const clueField = nearestRichField({
        worldSeed,
        sector,
        position: wreck.position,
      });

      return {
        ...wreck,
        ...(clueField && {
          cargoContents: wreck.cargoContents.map(() => clueField.resource),
          clueField,
        }),
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
  });
};
