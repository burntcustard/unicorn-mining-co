import { replication } from './replication';

export const regionSize = 2000;

export const worldRanges = {
  asteroid: 2000,
  item: 2000,
  stationMarker: 10000,
  stationPhysics: 2000,
  wreck: 2000,
} as const;

export const serverRegionRanges = {
  // Keep radar dots available until their outer edge clears the map.
  asteroid: replication.entityUnload * 1.1,
  item: 2000,
  stationMarker: 10000,
  stationPhysics: 11000,
  wreck: replication.entityUnload,
} as const;
