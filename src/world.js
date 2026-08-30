import { distribute } from './distribute.js';
import { seededRandom } from './seeded-random.js';

const worldRadius = 40000;
const asteroidFieldProfiles = {
  ordinary: {
    contentsChance: 0.2,
    resources: { gold: 4, amethyst: 3, opal: 2, diamond: 1 },
    weight: 10,
  },
  gold: { contentsChance: 0.5, weight: 3 },
  amethyst: { contentsChance: 1, itemLimit: 1, size: 0.5, weight: 2 },
  opal: { weight: 4 },
  diamond: { weight: 1 },
};
const randomStep = (random, from, to, step) =>
  Number((from + Math.floor(random() * ((to - from) / step + 1)) * step).toFixed(10));
const randomDirection = (random) => Math.round(random()) * 2 - 1;
const randomSpin = (random) => randomDirection(random) * (1 + random()) / 40;

const weightedKey = (random, profiles) => {
  const weight = (profile) => profile.weight || profile;
  let choice = random() * Object.values(profiles).reduce((sum, profile) => sum + weight(profile), 0);

  return Object.keys(profiles).find((key) => (choice -= weight(profiles[key])) < 0);
};

const makeAsteroids = (field, worldObjects, random) => {
  const profile = asteroidFieldProfiles[field.resource];
  const count = Math.round(Math.PI * field.fieldRadius ** 2 * field.aspectRatio / 320000);
  const asteroids = Array.from({ length: count }, () => {
    const radius = (50 + random() * 100) * (profile.size || 1);
    const capacity = Math.round(Math.sqrt(radius) / 3) * 2;
    let contents = [];

    if (random() < (profile.contentsChance ?? capacity / (capacity + 1))) {
      const itemCount = profile.itemLimit || 1 + Math.floor(random() * capacity);

      contents = Array.from({ length: itemCount }, () => profile.resources ?
          weightedKey(random, profile.resources) :
        field.resource);
    }

    return {
      collisionRadius: radius * 1.15,
      contents,
      radius,
      rotation: random() * Math.PI * 2,
      spin: randomSpin(random),
    };
  });
  const avoid = worldObjects.filter((object) =>
    Math.hypot(object.x - field.x, object.y - field.y) < field.fieldRadius + object.radius);

  return distribute(asteroids, {
    aspectRatio: field.aspectRatio,
    radius: field.fieldRadius,
    rotation: field.rotation,
    x: field.x,
    y: field.y,
  }, [], avoid, random);
};

/** Generate the complete, deterministic map blueprint for a seed. */
export const generateWorld = (seed) => {
  const random = seededRandom(seed);
  const stations = distribute(Array.from({ length: 32 }, () => ({
    radius: 400,
    spin: randomDirection(random) / 20,
  })), {
    density: 9000,
    radius: worldRadius,
    variance: 2000,
  }, [], [], random);
  const wrecks = distribute(Array.from({ length: 32 }, () => ({
    radius: 100,
    spin: randomSpin(random),
  })), {
    density: 400,
    radius: worldRadius,
    variance: 300,
  }, [], [], random);
  const fields = distribute(Array.from({ length: 64 }, () => {
    const fieldRadius = randomStep(random, 2100, 6200, 100);
    const aspectRatio = randomStep(random, 0.2, 0.9, 0.1);

    return {
      aspectRatio,
      fieldRadius,
      radius: fieldRadius * aspectRatio * 0.4,
      resource: weightedKey(random, asteroidFieldProfiles),
      rotation: random() * Math.PI * 2,
    };
  }), {
    density: 500,
    radius: worldRadius,
    variance: 300,
  }, [], [], random);
  const worldObjects = [...stations, ...wrecks];

  fields.forEach((field) => {
    field.asteroids = makeAsteroids(field, worldObjects, random);
    worldObjects.push(...field.asteroids);
  });

  return { fields, radius: worldRadius, stations, wrecks };
};

/** Starting-station choice is deliberately outside deterministic generation. */
export const chooseStartingStation = ({ stations }, random = Math.random) =>
  stations[Math.floor(random() * stations.length)];
