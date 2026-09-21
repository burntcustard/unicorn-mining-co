import { Vector, type Vector as VectorValue } from '../vector';
import {
  type LoadedRegion,
  type RegionalView,
  type RegionDescription,
  type WorldRanges,
} from '../protocol/regions';
import { generateRegion, regionSeed, regionSize } from './region-generation';

export const worldRanges: WorldRanges = {
  asteroid: 2000,
  item: 2000,
  stationMarker: 10000,
  stationPhysics: 2000,
  wreck: 2000,
};

const keyOf = ({ region }: { region: VectorValue }) =>
  `${region.x},${region.y}`;

const descriptionsWithin = <Description extends { position: VectorValue }>({
  descriptions,
  position,
  range,
}: {
  descriptions: Description[];
  position: VectorValue;
  range: number;
}) =>
  descriptions.filter(
    (description) => description.position.distanceTo(position) <= range,
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

  load({ region }: { region: VectorValue }): LoadedRegion {
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

  unload({ region }: { region: VectorValue }) {
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
    position: VectorValue;
    ranges?: WorldRanges;
  }): RegionalView {
    const reach = Math.max(...Object.values(ranges));
    const from = Vector(
      Math.floor((position.x - reach) / regionSize),
      Math.floor((position.y - reach) / regionSize),
    );
    const to = Vector(
      Math.floor((position.x + reach) / regionSize),
      Math.floor((position.y + reach) / regionSize),
    );
    const needed = new Set<string>();
    const descriptions: RegionDescription[] = [];

    for (let x = from.x; x <= to.x; x++) {
      for (let y = from.y; y <= to.y; y++) {
        const region = Vector(x, y);

        needed.add(keyOf({ region }));
        descriptions.push(this.load({ region }).description);
      }
    }

    [...this.loaded.values()].forEach(({ description }) => {
      if (!needed.has(keyOf({ region: description.region })))
        this.unload({ region: description.region });
    });

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
  }
}
