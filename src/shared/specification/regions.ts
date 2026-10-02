// Procedural generation parameters. The Go catalog is generated from this object.
export const regionGenerationSpecification = {
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
} as const satisfies {
  features: readonly {
    size: number;
    chance: number;
    clearance: number;
    kind: number;
  }[];
  stationStream: number;
  stationRadius: number;
  wreckRadius: number;
  fieldRadius: number;
  fieldRadiusRange: number;
  richFieldAmethystChance: number;
  richFieldGoldChance: number;
  nearestFieldInitialRange: number;
  fieldSearchMargin: number;
  asteroidCounts: Record<'amethyst' | 'gold' | 'mixed', number>;
  asteroidBaseRadius: number;
  asteroidAmethystRadius: number;
  asteroidAmethystRange: number;
  asteroidGoldRadius: number;
  asteroidGoldRange: number;
  asteroidMixedRadius: number;
  asteroidMixedRange: number;
  mixedItemChance: number;
  mixedItemLimit: number;
  asteroidSpacing: number;
  asteroidVariance: number;
  asteroidPointCountScale: number;
};
