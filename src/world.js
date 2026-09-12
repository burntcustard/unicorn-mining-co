import { Vector } from './vector.js';
import { colors } from './colors.js';
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

  // An amethyst field is spikes
  const spikes = field.resource === 1;

  // Roughly one asteroid per 100,000 square metres of the field
  const count = field.fieldRadius ** 2 / 30000;

  const asteroids = Array.from({ length: count }, () => {
    const radius = 50 + (spikes ? 50 + random() * 2 : random() * 120);
    // Small rocks hold little; capacity rises smoothly with size.
    const capacity = Math.round((radius / 50) ** 2);

    let contents = [];

    // A rich field is packed with its resource, while a mixed field is mostly bare rock
    if (random() < (mixed ? 0.3 : capacity / (capacity + 1))) {
      const itemCount = spikes ? 1 : 1 + Math.floor(random() * capacity);

      contents = Array.from({ length: itemCount },
        () => mixed ? randomResource(random) : field.resource);
    }

    return {
      contents,
      radius,
      ...(spikes && { points: 6, radiusEven: radius / 4, fill: `${colors.purple[1]}9`, stroke: colors.violet[2] }),
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
    radius: 400, spin: randomSpin(random),
  })), { density: 8000, radius: worldRadius }, [], random);

  const wrecks = distribute(Array.from({ length: 32 }, () => ({
    radius: 100, spin: randomSpin(random),
  })), { density: 5500, radius: worldRadius }, [], random)
    .sort((a, b) => b.x ** 2 + b.y ** 2 - a.x ** 2 - a.y ** 2);

  const fields = distribute(Array.from({ length: 200 }, () => {
    const roll = random();
    const resource = roll < 0.1 ? 1 : roll < 0.2 ? 2 : 4;

    // Amethyst comes in small pockets
    const fieldRadius = (2000 + random() * 2000) / (resource < 2 ? 2 : 1);

    return {
      fieldRadius,
      radius: fieldRadius * 0.7,
      resource,
    };
  }), {
    density: 350,
    radius: worldRadius,
  }, [], random);

  const clueFields = fields.filter(({ resource }) => resource === 1 || resource === 2);

  const wreckFields = wrecks.map((wreck) => {
    const position = Vector(wreck.x, wreck.y);
    const field = clueFields.reduce((nearest, candidate) =>
      position.distanceTo(candidate) < position.distanceTo(nearest) ? candidate : nearest);

    return { distance: position.distanceTo(field), field, wreck };
  });

  // Each rich field gets slates on the three nearest wrecks that point to it.
  const clueWrecks = new Set(clueFields.flatMap((field) =>
    wreckFields.filter((wreckField) => wreckField.field === field)
      .sort((a, b) => a.distance - b.distance).slice(0, 3)));

  wreckFields.forEach((wreckField, index) => {
    const { field, wreck } = wreckField;
    const hasClue = clueWrecks.has(wreckField);
    wreck.shades = [colors.yellow, colors.green, colors.cyan, colors.red][index] || colors.orange;
    wreck.cargo = Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
      hasClue ? field.resource : Math.floor(random() * 4));

    if (hasClue) {
      wreck.message = `${field.resource === 1 ? 'AMETHYST CLUSTER' : 'GOLD ORE'} ${Math.round(field.x)}/${Math.round(field.y)}`;
    }
  });

  const worldObjects = [...stations, ...wrecks];

  fields.forEach((field) => {
    field.asteroids = makeAsteroids(field, worldObjects, random);
    worldObjects.push(...field.asteroids);
  });

  return { fields, stations, wrecks };
};
