import * as Vec from '../../client/utilities/vector';
import { type Sector } from '../../client/simulation/sector-generation';
import {
  generateFields,
  generateStations,
  generateWrecks,
  generateRegion,
} from '../../client/simulation/region-generation';
import { regionSize } from '../../specs/region-manager';
import { regionGeneration } from '../../specs/region-generation';
import { type RegionDescription } from '../../client/protocol/regions';

export type SceneRequest = {
  worldSeed: number;
  sector: Sector;
  from: Vec.Value;
  to: Vec.Value;
  detail: boolean;
};

/**
 * Overview sampling never instantiates all regions across an entire sector.
 * Zoomed detail uses the same region generator as the server parity fixtures.
 */
export const generateScene = (options: SceneRequest) => {
  const { from, to } = options;
  const fieldSize = regionGeneration.features[0].size;
  const cells =
    Math.ceil((to.x - from.x) / fieldSize + 2) *
    Math.ceil((to.y - from.y) / fieldSize + 2);
  const margin = regionGeneration.fieldSearchMargin;

  const fields =
    cells <= 40000
      ? generateFields({
          ...options,
          from: Vec.add(from, Vec.create(-margin, -margin)),
          to: Vec.add(to, Vec.create(margin, margin)),
        })
      : [];

  const stations = cells <= 40000 ? generateStations(options) : [];
  const wrecks = cells <= 40000 ? generateWrecks(options) : [];
  const first = Vec.create(
    Math.floor(from.x / regionSize),
    Math.floor(from.y / regionSize),
  );
  const last = Vec.create(
    Math.floor(to.x / regionSize),
    Math.floor(to.y / regionSize),
  );
  const detailed =
    options.detail && (last.x - first.x + 1) * (last.y - first.y + 1) <= 256;
  const asteroids: RegionDescription['asteroids'] = [];

  if (detailed) {
    for (let x = first.x; x <= last.x; x++) {
      for (let y = first.y; y <= last.y; y++) {
        asteroids.push(
          ...generateRegion({ ...options, region: Vec.create(x, y) }).asteroids,
        );
      }
    }
  }

  return {
    fields,
    stations,
    wrecks,
    asteroids,
    detailed,
    overview: cells <= 40000,
  };
};

export type Scene = ReturnType<typeof generateScene>;
