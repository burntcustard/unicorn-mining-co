import * as Vec from '../vector';
import {
  type LoadedRegion,
  type RegionalView,
  type RegionDescription,
  type WorldRanges,
  type StationDescription,
} from '../protocol/regions';
import { regionSize, worldRanges } from '../settings';
import {
  generateRegion,
  generateStations,
  regionSeed,
} from './region-generation';

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
    (description) =>
      Vec.distanceSquared(description.position, position) <= range * range,
  );

export class RegionManager {
  private loaded = new Map<string, LoadedRegion>();
  private saved = new Map<string, RegionDescription>();
  private worldSeed: number;
  private removed = new Set<number>();
  private queriedRegions?: {
    bounds: string;
    descriptions: RegionDescription[][];
    stations: StationDescription[][];
  };

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

    this.queriedRegions = undefined;
    this.saved.delete(key);
    this.loaded.set(key, loaded);
    return loaded;
  }

  unload({ region }: { region: Vec.Value }) {
    const key = keyOf({ region });
    const loaded = this.loaded.get(key);

    if (!loaded) return;
    this.queriedRegions = undefined;
    this.saved.set(key, loaded.description);
    this.loaded.delete(key);
  }

  remove({ id }: { id: number }) {
    this.removed.add(id);
    this.queriedRegions = undefined;
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
    // Marker range needs station seeds, not full asteroid generation.
    const boundsFor = (reach: number) =>
      positions.map((position) => ({
        from: Vec.create(
          Math.floor((position.x - reach) / regionSize),
          Math.floor((position.y - reach) / regionSize),
        ),
        to: Vec.create(
          Math.floor((position.x + reach) / regionSize),
          Math.floor((position.y + reach) / regionSize),
        ),
      }));
    const bounds = boundsFor(Math.max(ranges.asteroid, ranges.wreck));
    const stationBounds = boundsFor(
      Math.max(ranges.stationMarker, ranges.stationPhysics),
    );
    const key = [...bounds, ...stationBounds]
      .map(({ from, to }) => `${from.x},${from.y},${to.x},${to.y}`)
      .join(';');

    // Movement within the same region rectangles changes range filtering, but
    // not the loaded region union. Reuse that union until a boundary is crossed.
    if (this.queriedRegions?.bounds !== key) {
      const needed = new Set<string>();
      const descriptions = bounds.map(({ from, to }) => {
        const found: RegionDescription[] = [];

        for (let x = from.x; x <= to.x; x++) {
          for (let y = from.y; y <= to.y; y++) {
            const region = Vec.create(x, y);

            needed.add(keyOf({ region }));
            found.push(this.load({ region }).description);
          }
        }
        return found;
      });

      [...this.loaded.values()].forEach(({ description }) => {
        if (!needed.has(keyOf({ region: description.region }))) {
          this.unload({ region: description.region });
        }
      });
      const stations = stationBounds.map(({ from, to }) => {
        const found: StationDescription[] = [];

        for (let x = from.x; x <= to.x; x++) {
          for (let y = from.y; y <= to.y; y++) {
            const region = Vec.create(x, y);
            const key = keyOf({ region });
            const description =
              this.loaded.get(key)?.description || this.saved.get(key);
            const candidates =
              description?.stations ||
              generateStations({
                worldSeed: this.worldSeed,
                from: Vec.scale(region, regionSize),
                to: Vec.scale(Vec.add(region, Vec.create(1, 1)), regionSize),
              });

            found.push(...candidates.filter(({ id }) => !this.removed.has(id)));
          }
        }
        return found;
      });

      this.queriedRegions = { bounds: key, descriptions, stations };
    }

    return positions.map((position, index) => {
      const descriptions = this.queriedRegions!.descriptions[index];
      const stations = this.queriedRegions!.stations[index];

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
  }
}
