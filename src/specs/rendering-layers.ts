export const renderingLayers = {
  stationFloor: 0,
  scenery: 1,
  modulesBelowShipHull: 2,
  glowBelowShips: 3,
  modulesInsideShipHull: 4,
  shipHull: 5,
  modulesAboveShipHull: 6,
  glowAboveShips: 7,
  modulesBelowStationHull: 8,
  glowBelowStations: 9,
  stationHull: 10,
  modulesAboveStationHull: 11,
  glowAboveStations: 12,
} as const;

export type RenderingLayer =
  (typeof renderingLayers)[keyof typeof renderingLayers];
