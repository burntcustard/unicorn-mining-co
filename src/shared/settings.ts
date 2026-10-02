import { simulationSpecification } from './specification/simulation';
import { type WorldRanges } from './protocol/regions';

export const linearSlop = simulationSpecification.linearSlop;
export const contactSpeedThreshold =
  simulationSpecification.contactSpeedThreshold;
export const simulationStep = simulationSpecification.simulationStep;
export const maxCatchUpTicks = simulationSpecification.maxCatchUpTicks;
export const maxPredictionTicks = simulationSpecification.maxPredictionTicks;
export const visibleRange = simulationSpecification.visibleRange;
export const updateTiers = simulationSpecification.updateTiers;
export const ballisticReplicateEvery =
  simulationSpecification.ballisticReplicateEvery;
export const regionSize = simulationSpecification.regionSize;
export const preGeneratedRadius = simulationSpecification.preGeneratedRadius;
export const worldRanges: WorldRanges = simulationSpecification.worldRanges;
