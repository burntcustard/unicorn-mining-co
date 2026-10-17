import { sectorNames, sectorGeneration as spec } from '../../specs/sectors';
import * as Vec from '../utilities/vector';
import { createRandom } from '../utilities/seeded-random';
import { namedSeed } from '../utilities/seed-hash';
import { sinCos } from '../utilities/sin-cos';

export type SectorConnectionSite = {
  id: string;
  position: Vec.Value;
  arrival: Vec.Value;
  radius: number;
};

export type Sector = {
  id: string;
  name: string;
  seed: number;
  mapPosition: Vec.Value;
  radiusX: number;
  radiusY: number;
  rotation: number;
  gateSites: SectorConnectionSite[];
  wormholeSites: SectorConnectionSite[];
};

export type SectorLink = {
  id: string;
  sectors: [string, string];
  sites: [number, number];
  rotation: number;
};

export type SectorMap = {
  sectors: Sector[];
  links: SectorLink[];
  wormholeLinks: SectorLink[];
  enabled: string[];
};

export const sectorId = (name: string) => name.toLowerCase();

/**
 * Site positions depend on their own index, so adding a passage never moves an
 * existing one. The first two of each kind are on opposite sides of the sector.
 */
const connectionSite = ({
  sector,
  index,
  wormhole,
}: {
  sector: Pick<Sector, 'id' | 'seed' | 'radiusX' | 'radiusY' | 'rotation'>;
  index: number;
  wormhole: boolean;
}): SectorConnectionSite => {
  const kind = wormhole ? 'wormhole' : 'gate';
  const random = createRandom(
    namedSeed({ seed: sector.seed, name: `${kind}:${index}` }),
  );
  const rotation =
    createRandom(namedSeed({ seed: sector.seed, name: 'connections' })).next() *
    Math.PI *
    2;
  const axis = sinCos({ sin: 0, cos: 0 }, sector.rotation);
  const angle = sinCos(
    { sin: 0, cos: 0 },
    rotation + (([0, 2, 1, 3][index] * 2 + Number(wormhole)) * Math.PI) / 4,
  );
  const x = angle.cos * sector.radiusX;
  const y = angle.sin * sector.radiusY;
  const axisLength = Math.sqrt(x * x + y * y);
  const minimum = wormhole ? spec.wormholeDistance : spec.gateDistance;
  const maximum = Math.min(
    minimum + (wormhole ? spec.wormholeDistanceRange : spec.gateDistanceRange),
    spec.maxConnectionDistance / axisLength,
  );
  const inner = Math.min(minimum, maximum);
  const sample = random.next();
  // Sampling wormholes by area favors the outer part of their wider annulus.
  const distance = wormhole
    ? Math.sqrt(inner * inner + sample * (maximum * maximum - inner * inner))
    : inner + sample * (maximum - inner);
  const position = Vec.create(
    Math.round((x * axis.cos - y * axis.sin) * distance),
    Math.round((x * axis.sin + y * axis.cos) * distance),
  );
  const length = Vec.length(position);
  const arrival = Vec.create(
    Math.round(position.x * (1 - spec.gateArrivalDistance / length)),
    Math.round(position.y * (1 - spec.gateArrivalDistance / length)),
  );

  return {
    id: `${sector.id}:${kind}:${index}`,
    position,
    arrival,
    radius: wormhole ? spec.wormholeRadius : spec.gateRadius,
  };
};

export const generateSector = ({
  worldSeed,
  name,
}: {
  worldSeed: number;
  name: string;
}): Sector => {
  const id = sectorId(name);
  const seed = namedSeed({ seed: worldSeed, name: id });
  const random = createRandom(seed);
  const size = random.next();
  const radiusX = Math.round(
    (spec.cruiseSpeed *
      60 *
      (spec.crossingMinutes + size * spec.crossingMinutesRange)) /
      2,
  );
  const radiusY = Math.round(
    radiusX * (spec.aspectRatio + random.next() * spec.aspectRatioRange),
  );
  const rotation = (Math.round(random.next() * 360) * Math.PI) / 180;
  const mapRandom = createRandom(namedSeed({ seed, name: 'map' }));
  const mapAngle = sinCos({ sin: 0, cos: 0 }, mapRandom.next() * Math.PI * 2);
  const mapRadius = Math.sqrt(mapRandom.next());
  const mapPosition = Vec.create(
    Math.round(mapRadius * mapAngle.cos * spec.mapRadiusX),
    Math.round(mapRadius * mapAngle.sin * spec.mapRadiusY),
  );
  const countRandom = createRandom(
    namedSeed({ seed, name: 'connection-counts' }),
  );
  const countRange = 2 + size * (spec.maxConnections - 1);
  let gateCount = Math.floor(countRandom.next() * countRange);
  let wormholeCount = Math.floor(countRandom.next() * countRange);

  if (!gateCount && !wormholeCount) {
    if (countRandom.next() < 0.5) {
      gateCount = 1;
    } else {
      wormholeCount = 1;
    }
  }

  const geometry = { id, seed, radiusX, radiusY, rotation };
  const gateSites = Array.from({ length: gateCount }, (_, index) =>
    connectionSite({ sector: geometry, index, wormhole: false }),
  );
  const wormholeSites = Array.from({ length: wormholeCount }, (_, index) =>
    connectionSite({ sector: geometry, index, wormhole: true }),
  );

  return {
    id,
    name,
    seed,
    mapPosition,
    radiusX,
    radiusY,
    rotation,
    gateSites,
    wormholeSites,
  };
};

/**
 * Connect a catalog batch, then fill spare sites with shortcuts. Completed
 * batches stay fixed when names are appended; enabling sectors changes no links.
 */
export const generateSectorMap = ({
  worldSeed,
  names = sectorNames,
  enabledCount = spec.enabledCount,
}: {
  worldSeed: number;
  names?: readonly string[];
  enabledCount?: number;
}): SectorMap => {
  const sectors = names.map((name) => generateSector({ worldSeed, name }));
  const anchor = sectors.find((sector) => sector.id === spec.graphAnchor);

  if (!anchor || new Set(sectors.map(({ id }) => id)).size !== sectors.length) {
    throw new Error(
      'The sector catalog needs unique IDs and its graph anchor.',
    );
  }

  const ordered = [anchor, ...sectors.filter((sector) => sector !== anchor)];
  const links: SectorLink[] = [];
  const wormholeLinks: SectorLink[] = [];
  const degrees = new Map<string, number>(sectors.map(({ id }) => [id, 0]));
  const wormholeDegrees = new Map(degrees);
  const connected = [anchor];
  const linkId = (a: Sector, b: Sector) => [a.id, b.id].sort().join('/');

  const connect = (
    a: Sector,
    b: Sector,
    target: SectorLink[],
    counts: Map<string, number>,
  ) => {
    const id = linkId(a, b);

    target.push({
      id,
      sectors: [a.id, b.id],
      sites: [counts.get(a.id)!, counts.get(b.id)!],
      rotation:
        createRandom(namedSeed({ seed: worldSeed, name: id })).next() *
        Math.PI *
        2,
    });

    counts.set(a.id, counts.get(a.id)! + 1);
    counts.set(b.id, counts.get(b.id)! + 1);
  };

  const freeSites = () =>
    connected.reduce(
      (sum, sector) =>
        sum +
        sector.gateSites.length -
        degrees.get(sector.id)! +
        sector.wormholeSites.length -
        wormholeDegrees.get(sector.id)!,
      0,
    );

  const fillSites = (
    target: SectorLink[],
    counts: Map<string, number>,
    kind: 'gateSites' | 'wormholeSites',
    reserve: number,
  ) => {
    const existing = new Set(target.map(({ id }) => id));
    let free = connected.reduce(
      (sum, sector) => sum + sector[kind].length - counts.get(sector.id)!,
      0,
    );

    const needed = (sector: Sector) =>
      Math.max(0, Math.min(3, sector[kind].length) - counts.get(sector.id)!);
    const remaining = (sector: Sector) =>
      sector[kind].length - counts.get(sector.id)!;

    while (free >= reserve + 2) {
      const available = connected
        .filter((sector) => remaining(sector) > 0)
        .sort(
          (a, b) =>
            needed(b) - needed(a) ||
            remaining(b) - remaining(a) ||
            (a.id < b.id ? -1 : 1),
        );
      const a = available.find((entry) =>
        available.some(
          (other) => other !== entry && !existing.has(linkId(entry, other)),
        ),
      );

      if (!a) break;
      const b = available
        .filter((entry) => entry !== a && !existing.has(linkId(a, entry)))
        .sort(
          (b, c) =>
            needed(c) - needed(b) ||
            remaining(c) - remaining(b) ||
            Vec.distanceSquared(a.mapPosition, b.mapPosition) -
              Vec.distanceSquared(a.mapPosition, c.mapPosition) ||
            (b.id < c.id ? -1 : 1),
        )[0];

      connect(a, b, target, counts);
      existing.add(linkId(a, b));
      free -= 2;
    }
  };

  for (let start = 1; start < ordered.length;) {
    const end = Math.min(
      ordered.length,
      spec.graphStages.find((limit) => limit > start) ?? start + 1,
    );
    const pending = ordered.slice(start, end);
    const expandable = new Set(ordered.slice(start === 1 ? 0 : start, end));

    while (pending.length) {
      const free = freeSites();

      const connection = (entry: Sector) => {
        for (const kind of ['gateSites', 'wormholeSites'] as const) {
          if (!entry[kind].length) continue;
          const counts = kind === 'gateSites' ? degrees : wormholeDegrees;
          const other = connected
            .filter(
              (candidate) => counts.get(candidate.id)! < candidate[kind].length,
            )
            .sort(
              (a, b) =>
                Vec.distanceSquared(a.mapPosition, entry.mapPosition) -
                  Vec.distanceSquared(b.mapPosition, entry.mapPosition) ||
                (a.id < b.id ? -1 : 1),
            )[0];

          if (other) {
            return {
              other,
              counts,
              target: kind === 'gateSites' ? links : wormholeLinks,
            };
          }
        }
      };

      // Delay a leaf if it would close the last route for expansion, and match
      // like endpoints: a wormhole-only sector must attach through a wormhole.
      const index = pending.findIndex(
        (entry) =>
          (free > 1 ||
            entry.gateSites.length + entry.wormholeSites.length > 1 ||
            pending.length === 1) &&
          connection(entry),
      );

      if (!free || index < 0) {
        // Random draws can exhaust one kind of endpoint before every sector
        // joins the network. Add the fewest sites needed, favoring larger
        // sectors. Earlier catalog batches and existing positions stay fixed.
        const capacity = (entry: Sector) =>
          Math.min(
            spec.maxConnections,
            Math.floor(
              2 +
                (((entry.radiusX * 2) / spec.cruiseSpeed / 60 -
                  spec.crossingMinutes) /
                  spec.crossingMinutesRange) *
                  (spec.maxConnections - 1),
            ),
          );

        const options = (['gateSites', 'wormholeSites'] as const)
          .flatMap((kind) => {
            const counts = kind === 'gateSites' ? degrees : wormholeDegrees;

            return connected
              .flatMap((a) =>
                pending.map((b) => {
                  const addA = Number(counts.get(a.id) === a[kind].length);
                  const addB = Number(!b[kind].length);

                  return {
                    a,
                    b,
                    kind,
                    counts,
                    addA,
                    addB,
                    id: `${linkId(a, b)}/${kind}`,
                  };
                }),
              )
              .filter(
                ({ a, b, addA, addB }) =>
                  (!addA || expandable.has(a)) &&
                  a[kind].length + addA <= capacity(a) &&
                  b[kind].length + addB <= capacity(b),
              );
          })
          .sort(
            (a, b) =>
              a.addA + a.addB - b.addA - b.addB ||
              b.a.radiusX + b.b.radiusX - a.a.radiusX - a.b.radiusX ||
              (a.id < b.id ? -1 : 1),
          );

        const bridge = options[0];

        if (!bridge) {
          throw new Error('The sector catalog needs more connection capacity.');
        }

        const { a, b, kind, counts, addA, addB } = bridge;

        if (addA) {
          a[kind].push(
            connectionSite({
              sector: a,
              index: a[kind].length,
              wormhole: kind === 'wormholeSites',
            }),
          );
        }

        if (addB) {
          b[kind].push(
            connectionSite({
              sector: b,
              index: b[kind].length,
              wormhole: kind === 'wormholeSites',
            }),
          );
        }

        connect(a, b, kind === 'gateSites' ? links : wormholeLinks, counts);
        connected.push(b);
        pending.splice(pending.indexOf(b), 1);
        continue;
      }

      const [entry] = pending.splice(index, 1);
      const { other, target, counts } = connection(entry)!;

      connect(other, entry, target, counts);
      connected.push(entry);
    }

    fillSites(links, degrees, 'gateSites', spec.spareGateSites);
    fillSites(
      wormholeLinks,
      wormholeDegrees,
      'wormholeSites',
      spec.spareWormholeSites,
    );
    start = end;
  }

  return {
    sectors,
    links,
    wormholeLinks,
    enabled: connected
      .slice(0, Math.max(1, Math.min(sectors.length, enabledCount)))
      .map(({ id }) => id),
  };
};

export const sectorDensity = ({
  sector,
  position,
  kind,
}: {
  sector: Sector;
  position: Vec.Value;
  kind: number;
}) => {
  const falloff = spec.density[kind];
  const axis = sinCos({ sin: 0, cos: 0 }, sector.rotation);
  const x =
    (position.x * axis.cos + position.y * axis.sin) /
    (sector.radiusX * falloff.scale);
  const y =
    (-position.x * axis.sin + position.y * axis.cos) /
    (sector.radiusY * falloff.scale);
  const distance = x * x + y * y;
  const edge = falloff.cutoff ? 2 ** -(falloff.cutoff * falloff.cutoff) : 0;
  const density = Math.max(0, (2 ** -distance - edge) / (1 - edge));

  // Match probability thresholds despite tiny platform differences in exp2.
  return (
    Math.round(
      (falloff.floor + (falloff.peak - falloff.floor) * density) * 1e9,
    ) / 1e9
  );
};
