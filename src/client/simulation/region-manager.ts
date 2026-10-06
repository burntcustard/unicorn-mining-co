import * as Vec from '../utilities/vector';
import {
  type LoadedRegion,
  type RegionalView,
  type RegionDescription,
  type WorldRanges,
  type StationDescription,
} from '../protocol/regions';
import { regionSize } from '../../specs/region-manager';
import { worldRanges } from '../../specs/region-manager';
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
  private descriptionOwners = new Map<number, Set<RegionDescription>>();
  private loaded = new Map<string, LoadedRegion>();
  private queriedRegions?: {
    bounds: string;
    asteroids: RegionDescription['asteroids'][];
    wrecks: RegionDescription['wrecks'][];
    stations: StationDescription[][];
  };
  private removed = new Set<number>();
  private saved = new Map<string, RegionDescription>();
  private stationLists = new Map<string, StationDescription[]>();
  private worldSeed: number;

  constructor({ worldSeed }: { worldSeed: number }) {
    this.worldSeed = worldSeed;
  }

  load({ region }: { region: Vec.Value }): LoadedRegion {
    const key = keyOf({ region });
    const existing = this.loaded.get(key);

    if (existing) return existing;

    const description =
      this.saved.get(key) ||
      generateRegion({ worldSeed: this.worldSeed, region });

    if (!this.saved.has(key)) {
      this.stationLists.clear();
      description.asteroids = description.asteroids.filter(
        ({ id }) => !this.removed.has(id),
      );
      description.stations = description.stations.filter(
        ({ id }) => !this.removed.has(id),
      );
      description.wrecks = description.wrecks.filter(
        ({ id }) => !this.removed.has(id),
      );

      [
        ...description.asteroids,
        ...description.stations,
        ...description.wrecks,
      ].forEach(({ id }) => {
        const owners =
          this.descriptionOwners.get(id) || new Set<RegionDescription>();

        owners.add(description);
        this.descriptionOwners.set(id, owners);
      });
    }

    const loaded = {
      description,
      seed: regionSeed({ worldSeed: this.worldSeed, region }),
    };

    this.queriedRegions = undefined;
    this.saved.delete(key);
    this.loaded.set(key, loaded);
    return loaded;
  }

  get loadedRegionCount() {
    return this.loaded.size;
  }

  /**
   * Retain descriptions intersecting the central circle without activating them.
   */
  preGenerate({ radius }: { radius: number }) {
    const reach = Math.ceil(radius / regionSize);

    for (let x = -reach; x < reach; x++) {
      for (let y = -reach; y < reach; y++) {
        const nearestX = Math.max(x, 0, -x - 1) * regionSize;
        const nearestY = Math.max(y, 0, -y - 1) * regionSize;
        const region = Vec.create(x, y);

        if (
          nearestX * nearestX + nearestY * nearestY >= radius * radius ||
          this.loaded.has(keyOf({ region })) ||
          this.saved.has(keyOf({ region }))
        ) {
          continue;
        }

        this.load({ region });
        this.unload({ region });
      }
    }
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
        // Station sources change only when a region is first generated or
        // an object is removed, so other players' crossings reuse the list.
        const listKey = `${from.x},${from.y},${to.x},${to.y}`;
        const cached = this.stationLists.get(listKey);

        if (cached) return cached;
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

        if (this.stationLists.size >= 64) this.stationLists.clear();
        this.stationLists.set(listKey, found);
        return found;
      });

      this.queriedRegions = {
        bounds: key,
        asteroids: descriptions.map((regions) =>
          regions.flatMap(({ asteroids }) => asteroids),
        ),
        wrecks: descriptions.map((regions) =>
          regions.flatMap(({ wrecks }) => wrecks),
        ),
        stations,
      };
    }

    return positions.map((position, index) => {
      const stations = this.queriedRegions!.stations[index];

      return {
        asteroids: descriptionsWithin({
          descriptions: this.queriedRegions!.asteroids[index],
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
          descriptions: this.queriedRegions!.wrecks[index],
          position,
          range: ranges.wreck,
        }),
      };
    });
  }

  remove({ id }: { id: number }) {
    this.removed.add(id);
    this.queriedRegions = undefined;
    this.stationLists.clear();

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

    this.descriptionOwners.get(id)?.forEach(removeFrom);
    this.descriptionOwners.delete(id);
  }

  unload({ region }: { region: Vec.Value }) {
    const key = keyOf({ region });
    const loaded = this.loaded.get(key);

    if (!loaded) return;
    this.queriedRegions = undefined;
    this.saved.set(key, loaded.description);
    this.loaded.delete(key);
  }
}
