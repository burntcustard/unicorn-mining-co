/**
 * Create a deterministic pseudo-random function returning values in [0, 1).
 * Two billion values before it repeats, which is plenty for a world, and the
 * step off the seed keeps zero from sticking.
 **/
export const seededRandom = (seed) => () => (seed = (seed + 1) * 48271 % 2147483647) / 2147483647;
