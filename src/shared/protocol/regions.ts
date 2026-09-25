import * as Vec from '../vector';

export type StationDescription = {
  id: number;
  position: Vec.Value;
  radius: number;
  spin: number;
  type: 'station';
};

export type AsteroidDescription = {
  contents: number[];
  id: number;
  pointCount?: number;
  position: Vec.Value;
  radius: number;
  radiusEven?: number;
  resource: number;
  rotation: number;
  spin: number;
  type: 'asteroid';
};

export type WreckDescription = {
  cargoContents: number[];
  id: number;
  paint: number;
  position: Vec.Value;
  radius: number;
  spin: number;
  type: 'wreck';
};

export type RegionDescription = {
  asteroids: AsteroidDescription[];
  region: Vec.Value;
  stations: StationDescription[];
  wrecks: WreckDescription[];
};

export type LoadedRegion = {
  description: RegionDescription;
  seed: number;
};

export type WorldRanges = {
  asteroid: number;
  item: number;
  stationMarker: number;
  stationPhysics: number;
  wreck: number;
};

export type RegionalView = {
  asteroids: AsteroidDescription[];
  stationMarkers: StationDescription[];
  stations: StationDescription[];
  wrecks: WreckDescription[];
};
