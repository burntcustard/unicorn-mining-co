export const renderingLayers = {
  stationFloor: 0,
  scenery: 1,
  modulesBelowShipHull: 2,
  glowBelowShips: 3,
  shipHull: 4,
  modulesAboveShipHull: 5,
  glowAboveShips: 6,
  modulesBelowStationHull: 7,
  glowBelowStations: 8,
  stationHull: 9,
  modulesAboveStationHull: 10,
  glowAboveStations: 11,
} as const;

export type RenderingLayer =
  (typeof renderingLayers)[keyof typeof renderingLayers];
