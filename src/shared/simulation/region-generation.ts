import * as Vec from '../vector';
import {
  type AsteroidDescription,
  type RegionDescription,
  type StationDescription,
  type WreckDescription,
} from '../protocol/regions';
import { createRandom, type Random } from '../seeded-random';
import { regionSize } from '../settings';

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
  region,
}: {
  random: Random;
  region: Vec.Value;
}) =>
  Vec.create(
    (region.x + random.next()) * regionSize,
    (region.y + random.next()) * regionSize,
  );

const randomSpin = ({ random }: { random: Random }) =>
  ((random.next() < 0.5 ? -1 : 1) * (1 + random.next())) / 40;

const randomResource = ({ random }: { random: Random }) =>
  3 - Math.floor(random.next() ** 3 * 4);

const makeAsteroid = ({
  seed,
  index,
  random,
  region,
}: {
  seed: number;
  index: number;
  random: Random;
  region: Vec.Value;
}): AsteroidDescription => {
  const roll = random.next();
  const resource = roll < 0.05 ? 1 : roll < 0.12 ? 2 : 4;
  const spikes = resource === 1;
  const gold = resource === 2;
  const radius =
    50 +
    (spikes
      ? 50 + random.next() * 2
      : gold
        ? 110 + random.next() * 60
        : random.next() * 120);
  const capacity = Math.round((radius / 50) ** 2);
  const itemCount =
    random.next() < (resource > 3 ? 0.3 : capacity / (capacity + 1))
      ? spikes
        ? 1
        : 1 + Math.floor(random.next() * capacity)
      : 0;

  return {
    contents: Array.from({ length: itemCount }, () =>
      resource > 3 ? randomResource({ random }) : resource,
    ),
    id: descriptionId({ seed, kind: 1, index }),
    ...(spikes && { pointCount: 6, radiusEven: radius / 4 }),
    position: randomPosition({ random, region }),
    radius,
    resource,
    rotation: random.next() * Math.PI * 2,
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
}): RegionDescription => {
  const seed = regionSeed({ worldSeed, region });
  const random = createRandom(seed);
  const asteroidCount = 4 + Math.floor(random.next() * 5);
  const stations: StationDescription[] = [];
  const wrecks: WreckDescription[] = [];

  if (random.next() < 0.12) {
    stations.push({
      id: descriptionId({ seed, kind: 2, index: 0 }),
      position: randomPosition({ random, region }),
      radius: 400,
      spin: randomSpin({ random }),
      type: 'station',
    });
  }

  if (random.next() < 0.18) {
    wrecks.push({
      cargoContents: Array.from(
        { length: 2 + Math.floor(random.next() * 3) },
        () => Math.floor(random.next() * 4),
      ),
      id: descriptionId({ seed, kind: 3, index: 0 }),
      paint: Math.floor(random.next() * 5),
      position: randomPosition({ random, region }),
      radius: 100,
      spin: randomSpin({ random }),
      type: 'wreck',
    });
  }

  return {
    asteroids: Array.from({ length: asteroidCount }, (_, index) =>
      makeAsteroid({ seed, index, random, region }),
    ),
    region: Vec.clone(region),
    stations,
    wrecks,
  };
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

  return {
    ...current,
    asteroids: current.asteroids.filter(
      (asteroid) =>
        candidates.includes(asteroid) &&
        !candidates.some(
          (other) => other.id < asteroid.id && overlaps(asteroid, other),
        ),
    ),
  };
};
