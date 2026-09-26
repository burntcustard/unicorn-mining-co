import * as Vec from '../vector';
import {
  type LoadedRegion,
  type RegionalView,
  type RegionDescription,
  type WorldRanges,
} from '../protocol/regions';
import { regionSize, worldRanges } from '../settings';
import { generateRegion, regionSeed } from './region-generation';

const keyOf = ({ region }: { region: Vec.Value }) => `${region.x},${region.y}`;

const descriptionsWithin = <Description extends { position: Vec.Value }>({
  descriptions,
  position,
  range,
}: {
  descriptions: Description[];
  position: Vec.Value;
  range: number;
}) =>
  descriptions.filter(
    (description) => Vec.distance(description.position, position) <= range,
  );

export class RegionManager {
  private loaded = new Map<string, LoadedRegion>();
  private saved = new Map<string, RegionDescription>();
  private worldSeed: number;

  constructor({ worldSeed }: { worldSeed: number }) {
    this.worldSeed = worldSeed;
  }

  get loadedRegionCount() {
    return this.loaded.size;
  }

  load({ region }: { region: Vec.Value }): LoadedRegion {
    const key = keyOf({ region });
    const existing = this.loaded.get(key);

    if (existing) return existing;

    const description =
      this.saved.get(key) ||
      generateRegion({ worldSeed: this.worldSeed, region });
    const loaded = {
      description,
      seed: regionSeed({ worldSeed: this.worldSeed, region }),
    };

    this.saved.delete(key);
    this.loaded.set(key, loaded);
    return loaded;
  }

  unload({ region }: { region: Vec.Value }) {
    const key = keyOf({ region });
    const loaded = this.loaded.get(key);

    if (!loaded) return;
    this.saved.set(key, loaded.description);
    this.loaded.delete(key);
  }

  remove({ id }: { id: number }) {
    const removeFrom = (description: RegionDescription) => {
      description.asteroids = description.asteroids.filter(
        (asteroid) => asteroid.id !== id,
      );
      description.stations = description.stations.filter(
        (station) => station.id !== id,
      );
      description.wrecks = description.wrecks.filter(
        (wreck) => wreck.id !== id,
      );
    };

    [...this.loaded.values()].forEach(({ description }) =>
      removeFrom(description),
    );
    [...this.saved.values()].forEach((description) => removeFrom(description));
  }

  query({
    position,
    ranges = worldRanges,
  }: {
    position: Vec.Value;
    ranges?: WorldRanges;
  }): RegionalView {
    return this.queryMany({ positions: [position], ranges })[0];
  }

  queryMany({
    positions,
    ranges = worldRanges,
  }: {
    positions: Vec.Value[];
    ranges?: WorldRanges;
  }): RegionalView[] {
    const reach = Math.max(...Object.values(ranges));
    const needed = new Set<string>();
    const views = positions.map((position) => {
      const from = Vec.create(
        Math.floor((position.x - reach) / regionSize),
        Math.floor((position.y - reach) / regionSize),
      );
      const to = Vec.create(
        Math.floor((position.x + reach) / regionSize),
        Math.floor((position.y + reach) / regionSize),
      );
      const descriptions: RegionDescription[] = [];

      for (let x = from.x; x <= to.x; x++) {
        for (let y = from.y; y <= to.y; y++) {
          const region = Vec.create(x, y);

          needed.add(keyOf({ region }));
          descriptions.push(this.load({ region }).description);
        }
      }

      const stations = descriptions.flatMap(({ stations }) => stations);

      return {
        asteroids: descriptionsWithin({
          descriptions: descriptions.flatMap(({ asteroids }) => asteroids),
          position,
          range: ranges.asteroid,
        }),
        stationMarkers: descriptionsWithin({
          descriptions: stations,
          position,
          range: ranges.stationMarker,
        }),
        stations: descriptionsWithin({
          descriptions: stations,
          position,
          range: ranges.stationPhysics,
        }),
        wrecks: descriptionsWithin({
          descriptions: descriptions.flatMap(({ wrecks }) => wrecks),
          position,
          range: ranges.wreck,
        }),
      };
    });

    [...this.loaded.values()].forEach(({ description }) => {
      if (!needed.has(keyOf({ region: description.region }))) {
        this.unload({ region: description.region });
      }
    });

    return views;
  }
}
