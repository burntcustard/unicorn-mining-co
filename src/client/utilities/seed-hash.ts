export const mixSeed = (value: number) => {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
};

/**
 * Hash the catalog's ASCII IDs identically in TypeScript and Go.
 */
export const namedSeed = ({ seed, name }: { seed: number; name: string }) => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  }

  return mixSeed(seed ^ hash);
};
