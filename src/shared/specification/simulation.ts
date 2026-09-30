import type { WorldRanges } from '../protocol/regions';

// Numeric rules used by the TypeScript predictor and generated Go catalog.
export const simulationSpecification = {
  linearSlop: 0.5,
  contactSpeedThreshold: 5,
  physics: {
    maxTranslation: 200,
    maxRotation: Math.PI / 2,
    velocityIterations: 8,
    positionIterations: 3,
    wakeMargin: 10,
    aabbExtension: 10,
    aabbMultiplier: 2,
    positionBaumgarte: 0.2,
    toiBaumgarte: 0.75,
    maxLinearCorrection: 20,
    damageBase: 700,
    damageScale: 600,
  },
  simulationStep: 1 / 30,
  maxCatchUpTicks: 6,
  maxPredictionTicks: 15,
  visibleRange: 2000,
  ballisticReplicateEvery: 8,
  motion: {
    defaultDrag: 0.15,
    defaultMaxSpeed: 272,
    maxSpeedDrag: 0.9,
    minimumSpeedSquared: 1,
  },
  flight: {
    thrustScale: 220,
    steeringEase: 0.5,
    spinDivisor: 16,
    launchDuration: 3,
    launchHalfThreshold: 0.05,
    launchHalfEnd: 2,
    launchThrottle: 0.5,
    speedPerThrust: 17,
    uncrewedMaxSpeed: 180,
    angularInertiaScale: 1.5,
  },
  replication: {
    entityLoad: 2000,
    entityUnload: 2500,
    markerLoad: 10000,
    markerUnload: 11000,
  },
  serverRegionRanges: {
    asteroid: 2500,
    item: 2000,
    stationMarker: 10000,
    stationPhysics: 11000,
    wreck: 2500,
  },
  regionSize: 2000,
  preGeneratedRadius: 50000,
  updateTiers: {
    visible: { substeps: 2, updateEvery: 1, replicateEvery: 1 },
    distant: { substeps: 1, updateEvery: 2, replicateEvery: 4 },
    drift: { substeps: 1, updateEvery: 1, replicateEvery: 1 },
  },
  worldRanges: {
    asteroid: 2000,
    item: 2000,
    stationMarker: 10000,
    stationPhysics: 2000,
    wreck: 2000,
  },
} as const satisfies {
  linearSlop: number;
  contactSpeedThreshold: number;
  physics: {
    maxTranslation: number;
    maxRotation: number;
    velocityIterations: number;
    positionIterations: number;
    wakeMargin: number;
    aabbExtension: number;
    aabbMultiplier: number;
    positionBaumgarte: number;
    toiBaumgarte: number;
    maxLinearCorrection: number;
    damageBase: number;
    damageScale: number;
  };
  simulationStep: number;
  maxCatchUpTicks: number;
  maxPredictionTicks: number;
  visibleRange: number;
  ballisticReplicateEvery: number;
  motion: {
    defaultDrag: number;
    defaultMaxSpeed: number;
    maxSpeedDrag: number;
    minimumSpeedSquared: number;
  };
  flight: {
    thrustScale: number;
    steeringEase: number;
    spinDivisor: number;
    launchDuration: number;
    launchHalfThreshold: number;
    launchHalfEnd: number;
    launchThrottle: number;
    speedPerThrust: number;
    uncrewedMaxSpeed: number;
    angularInertiaScale: number;
  };
  replication: {
    entityLoad: number;
    entityUnload: number;
    markerLoad: number;
    markerUnload: number;
  };
  serverRegionRanges: WorldRanges;
  regionSize: number;
  preGeneratedRadius: number;
  updateTiers: Record<
    'visible' | 'distant' | 'drift',
    {
      substeps: number;
      updateEvery: number;
      replicateEvery: number;
    }
  >;
  worldRanges: WorldRanges;
};
