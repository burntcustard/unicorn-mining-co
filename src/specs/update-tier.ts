export const updateTiers = {
  visible: { substeps: 2, updateEvery: 1, replicateEvery: 1 },
  distant: { substeps: 1, updateEvery: 2, replicateEvery: 4 },
  drift: { substeps: 1, updateEvery: 1, replicateEvery: 1 },
} as const;
