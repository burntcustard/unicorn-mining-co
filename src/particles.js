import { colors } from './colors';

/**
 * Sparks streaming along a road, so that an empty stretch of space reads as
 * something that will sweep a ship along it.
 *
 * They are kept in road coordinates: `along` is how far down the road a spark
 * has got, and `across` is where it sits between the two edges. Each one winks
 * in and out somewhere along the way rather than running the whole length, so
 * that no two look alike and neither end of a road looks like a starting line.
 */

// Colors that are there to stand out, rather than the ones meant to sit
// behind things, which would be lost against the background
const backdrops = ['black', 'purple', 'white'];
const bright = Object.entries(colors)
  .filter(([name]) => !backdrops.includes(name))
  .map(([, shades]) => shades[2]);

// Seconds a spark lasts, and the shortest and longest streak one draws
const sparkLife = 2;
const shortest = 10;
const longest = 30;

const respawn = (spark, distance) => {
  spark.across = Math.random() - 0.5;
  spark.along = Math.random() * distance;
  spark.color = bright[Math.floor(Math.random() * bright.length)];
  spark.length = shortest + Math.random() * (longest - shortest);
  spark.life = Math.random() * sparkLife;
};

/**
 * @param {Number} count - Rounded down, so a road too small for one gets none.
 * @param {Number} distance - How far down the road the sparks may start.
 * @returns {Object[]} sparks
 */
export const makeSparks = (count, distance) => Array.from({ length: count }, () => {
  const spark = {};

  respawn(spark, distance);

  return spark;
});

/**
 * @param {Object[]} sparks
 * @param {Number} distance - How far the road runs.
 * @param {Number} speed - How fast the sparks travel down it.
 * @param {Number} dt - Seconds since the last update.
 */
export const updateSparks = (sparks, distance, speed, dt) => {
  sparks.forEach((spark) => {
    spark.along += speed * dt;
    spark.life -= dt;

    if (spark.life <= 0 || spark.along > distance) respawn(spark, distance);
  });
};
