import { type WorldRanges } from './protocol/regions';

// Physics Settings
export const linearSlop = 0.5;
export const contactSpeedThreshold = 5;

// Simulation Settings
export const simulationStep = 1 / 30; // 30 Hz authoritative clock
// Bound each collision sweep; excess elapsed time remains owed to later updates.
export const maxCatchUpTicks = 6;
export const maxPredictionTicks = 15;
export const visibleRange = 2000; // Distance for the visible update tier
export const updateTiers = {
  visible: { substeps: 2, updateEvery: 1, replicateEvery: 1 }, // 60 Hz movement, 30 Hz replication
  distant: { substeps: 1, updateEvery: 2, replicateEvery: 4 }, // 15 Hz movement, 7.5 Hz replication
  // Visible stationary objects without controls only spin: once per tick.
  drift: { substeps: 1, updateEvery: 1, replicateEvery: 1 }, // 30 Hz movement, 30 Hz replication
} as const;
// Asteroids and stations touching nothing only drift and spin, which
// receivers extrapolate.
export const ballisticReplicateEvery = 8;

// Region Settings
export const regionSize = 2000;
export const preGeneratedRadius = 50000;
export const worldRanges: WorldRanges = {
  asteroid: 2000,
  item: 2000,
  stationMarker: 10000,
  stationPhysics: 2000,
  wreck: 2000,
};
