// import { colors } from './colors';

/**
 * Sparks streaming along a road, so that an empty stretch of space reads as
 * something that will sweep a ship along it.
 *
 * ROADS ARE CURRENTLY UNUSED (commented out to save space)
 */

/*
// Colors that are there to stand out, rather than the ones meant to sit
// behind things, which would be lost against the background
const backdrops = ['black', 'purple', 'white'];
const bright = Object.entries(colors)
  .filter(([name]) => !backdrops.includes(name))
  .map(([, shades]) => shades[2]);

// Seconds a spark lasts, and the shortest and longest streak one draws
const sparklifetimetime = 2;
const shortest = 10;
const longest = 30;

const respawn = (spark, distance) => {
  spark.across = Math.random() - 0.5;
  spark.along = Math.random() * distance;
  spark.color = bright[Math.floor(Math.random() * bright.length)];
  spark.length = shortest + Math.random() * (longest - shortest);
  spark.lifetime = Math.random() * sparklifetimetime;
};

export const makeSparks = (count, distance) => Array.from({ length: count }, () => {
  const spark = {};

  respawn(spark, distance);

  return spark;
});

export const updateSparks = (sparks, distance, speed, dt) => {
  sparks.forEach((spark) => {
    spark.along += speed * dt;
    spark.lifetime -= dt;

    if (spark.lifetime <= 0 || spark.along > distance) respawn(spark, distance);
  });
};
*/

export const makeSparks = () => [];

export const updateSparks = () => {};
