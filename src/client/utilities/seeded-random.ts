/**
 * Create a deterministic pseudo-random function returning values in [0, 1).
 * Two billion values before it repeats, which is plenty for a world, and the
 * step off the seed keeps zero from sticking.
 **/
export const createRandom = (seed = 1) => {
  const random = {
    state: seed,
    next: () => {
      random.state = ((random.state + 1) * 48271) % 2147483647;
      return random.state / 2147483647;
    },
  };

  return random;
};

export const seededRandom = (seed: number) => createRandom(seed).next;

export type Random = ReturnType<typeof createRandom>;
