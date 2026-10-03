export const preGeneratedRadius = 50000;

// Procedural generation parameters. The Go catalog is generated from this object.
export const regionGeneration = {
  features: [
    { size: 6000, chance: 0.72, clearance: 350, kind: 4 },
    { size: 10000, chance: 0.32, clearance: 8000, kind: 2 },
    { size: 10000, chance: 0.5, clearance: 5500, kind: 3 },
  ],
  stationStream: 9,
  stationRadius: 400,
  wreckRadius: 100,
  fieldRadius: 2000,
  fieldRadiusRange: 2000,
  richFieldAmethystChance: 0.06,
  richFieldGoldChance: 0.18,
  nearestFieldInitialRange: 20000,
  fieldSearchMargin: 4000,
  asteroidCounts: { amethyst: 45, gold: 65, mixed: 75 },
  asteroidBaseRadius: 50,
  asteroidAmethystRadius: 50,
  asteroidAmethystRange: 2,
  asteroidGoldRadius: 110,
  asteroidGoldRange: 60,
  asteroidMixedRadius: 1.25,
  asteroidMixedRange: 120,
  mixedItemChance: 0.3,
  mixedItemLimit: 6,
  asteroidSpacing: 30,
  asteroidVariance: 0.2,
  asteroidPointCountScale: 0.3,
} as const;
