import { Vector, type Vector as VectorValue } from '../../vector';
import {
  type AsteroidDescription,
  type RegionDescription,
  type StationDescription,
  type WreckDescription,
} from '../protocol/regions';
import { createRandom, type Random } from '../../seeded-random';

export const regionSize = 2000;

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
  region: VectorValue;
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
  region: VectorValue;
}) =>
  Vector(
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
  region: VectorValue;
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
    ...(spikes && { points: 6, radiusEven: radius / 4 }),
    position: randomPosition({ random, region }),
    radius,
    resource,
    rotation: random.next() * Math.PI * 2,
    spin: randomSpin({ random }),
    type: 'asteroid',
  };
};

/**
 * Generate lightweight descriptions for exactly one deterministic region.
 */
export const generateRegion = ({
  worldSeed,
  region,
}: {
  worldSeed: number;
  region: VectorValue;
}): RegionDescription => {
  const seed = regionSeed({ worldSeed, region });
  const random = createRandom(seed);
  const asteroidCount = 4 + Math.floor(random.next() * 5);
  const stations: StationDescription[] = [];
  const wrecks: WreckDescription[] = [];

  if (random.next() < 0.12)
    stations.push({
      id: descriptionId({ seed, kind: 2, index: 0 }),
      position: randomPosition({ random, region }),
      radius: 400,
      spin: randomSpin({ random }),
      type: 'station',
    });

  if (random.next() < 0.18)
    wrecks.push({
      cargo: Array.from({ length: 2 + Math.floor(random.next() * 3) }, () =>
        Math.floor(random.next() * 4),
      ),
      id: descriptionId({ seed, kind: 3, index: 0 }),
      paint: Math.floor(random.next() * 5),
      position: randomPosition({ random, region }),
      radius: 100,
      spin: randomSpin({ random }),
      type: 'wreck',
    });

  return {
    asteroids: Array.from({ length: asteroidCount }, (_, index) =>
      makeAsteroid({ seed, index, random, region }),
    ),
    region: Vector(region.x, region.y),
    stations,
    wrecks,
  };
};
