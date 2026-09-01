import { distribute } from './distribute.js';
import { seededRandom } from './seeded-random.js';

export const worldRadius = 50000;

// Item types are dearest first, so cubing the roll leaves the cheap resources
// common and the precious ones rare
const randomResource = (random) => 3 - Math.floor(random() ** 3 * 4);

// Always turning one way or the other, and never slowly enough to look stopped
const randomSpin = (random) => (random() < 0.5 ? -1 : 1) * (1 + random()) / 40;

const makeAsteroids = (field, worldObjects, random) => {
  // A field of anything and everything, rather than one rich in a single resource
  const mixed = field.resource > 3;

  // An amethyst field is gravel: every rock as small as they come, one gem apiece
  const gravel = field.resource === 1;

  // Roughly one asteroid per 100,000 square metres of the field
  const count = field.fieldRadius ** 2 / 32000;

  const asteroids = Array.from({ length: count }, () => {
    const radius = 50 + (gravel ? 50 : random() * 100);
    // Small rocks hold little; capacity rises smoothly with size.
    const capacity = Math.round((radius / 50) ** 2);

    let contents = [];

    // A rich field is packed with its resource, while a mixed field is mostly bare rock
    if (random() < (mixed ? 0.3 : capacity / (capacity + 1))) {
      const itemCount = gravel ? 1 : 1 + Math.floor(random() * capacity);

      contents = Array.from({ length: itemCount },
        () => mixed ? randomResource(random) : field.resource);
    }

    return {
      contents,
      radius,
      ...(gravel && { points: 6, radiusEven: radius / 4 }),
      rotation: random() * Math.PI * 2,
      spin: randomSpin(random),
    };
  });

  const avoid = worldObjects.filter((object) =>
    Math.hypot(object.x - field.x, object.y - field.y) < field.fieldRadius + object.radius);

  // distribute appends to avoid, so remember where the new asteroids start
  const start = avoid.length;

  return distribute(asteroids, {
    density: 30,
    radius: field.fieldRadius,
    x: field.x,
    y: field.y,
  }, avoid, random).slice(start);
};

/** Generate the complete, deterministic map blueprint for a seed. */
export const generateWorld = (seed) => {
  const random = seededRandom(seed);

  const stations = distribute(Array.from({ length: 24 }, () => ({
    radius: 400,
    spin: randomSpin(random),
  })), {
    density: 8000,
    radius: worldRadius,
  }, [], random);

  const wrecks = distribute(Array.from({ length: 24 }, () => ({
    radius: 100,
    spin: randomSpin(random),
  })), {
    density: 250,
    radius: worldRadius,
  }, [], random);

  const fields = distribute(Array.from({ length: 100 }, () => {
    // 70% of fields hold a mix of everything; the rest are rich in one resource
    const resource = random() < 0.7 ? 4 : randomResource(random);

    // The dearest resources, diamond and amethyst, come in small pockets
    const fieldRadius = (2100 + random() * 1900) / (resource < 2 ? 2 : 1);

    return {
      fieldRadius,
      radius: fieldRadius * 0.4,
      resource,
    };
  }), {
    density: 350,
    radius: worldRadius,
  }, [], random);

  const worldObjects = [...stations, ...wrecks];

  fields.forEach((field) => {
    field.asteroids = makeAsteroids(field, worldObjects, random);
    worldObjects.push(...field.asteroids);
  });

  return { fields, stations, wrecks };
};
