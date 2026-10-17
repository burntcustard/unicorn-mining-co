import * as Vec from '../../../src/client/utilities/vector';
import {
  generateSectorMap,
  sectorDensity,
} from '../../../src/client/simulation/sector-generation';
import {
  generateRegion,
  generateStations,
  fieldMessage,
} from '../../../src/client/simulation/region-generation';

const regions = [0, 25, 4294967295].flatMap((worldSeed) =>
  [-12, -2, 0, 1, 9].flatMap((x) =>
    [-8, 0, 7].map((y) => {
      const region = Vec.create(x, y);

      return {
        worldSeed,
        region,
        description: generateRegion({ worldSeed, region }),
      };
    }),
  ),
);

const from = Vec.create(-50000, -50000);
const to = Vec.create(50000, 50000);

const stations = [0, 25, 4294967295].map((worldSeed) => ({
  worldSeed,
  from,
  to,
  stations: generateStations({ worldSeed, from, to }),
}));

const messages = [Vec.create(1000000, -2000000), Vec.create(-0, 3)].map(
  (position) => ({
    position,
    resource: 1,
    message: fieldMessage({ position, resource: 1 }),
  }),
);

const sectors = [0, 25, 52, 4294967295].map((worldSeed) => {
  const map = generateSectorMap({ worldSeed });

  const sampledIds = [
    ...new Set([
      'patroclus',
      'priamus',
      'anchises',
      ...map.sectors
        .filter((sector) => !sector.gateSites.length)
        .map(({ id }) => id),
    ]),
  ];

  const samples = sampledIds.flatMap((id) => {
    const sector = map.sectors.find((sector) => sector.id === id)!;

    const positions = [
      ...generateStations({
        worldSeed,
        sector,
        from: Vec.create(-sector.radiusX, -sector.radiusX),
        to: Vec.create(sector.radiusX, sector.radiusX),
      })
        .slice(0, 1)
        .map(({ position }) => position),
      // Probe otherwise eligible station cells in wormhole-only sectors too.
      ...(!sector.gateSites.length
        ? generateStations({
            worldSeed,
            sector: { ...sector, gateSites: [sector.wormholeSites[0]] },
            from: Vec.create(-sector.radiusX, -sector.radiusX),
            to: Vec.create(sector.radiusX, sector.radiusX),
          })
            .slice(0, 2)
            .map(({ position }) => position)
        : []),
      ...[...sector.gateSites, ...sector.wormholeSites].flatMap((site) => [
        site.position,
        site.arrival,
      ]),
    ];

    return [
      Vec.create(),
      Vec.create(-2, -3),
      Vec.create(648, 533),
      Vec.create(-1000, -1000),
      ...positions.map((position) =>
        Vec.create(
          Math.floor(position.x / 2000),
          Math.floor(position.y / 2000),
        ),
      ),
    ].map((region) => ({
      sectorId: id,
      region,
      description: generateRegion({ worldSeed, sector, region }),
    }));
  });

  const densities = map.sectors.flatMap((sector) =>
    [
      Vec.create(),
      Vec.create(sector.radiusX, -sector.radiusY),
      Vec.create(1e6, -1e6),
    ].map((position) => ({
      sectorId: sector.id,
      position,
      values: [0, 1, 2].map((kind) =>
        sectorDensity({ sector, position, kind }),
      ),
    })),
  );

  return { worldSeed, map, samples, densities };
});

export default { regions, stations, messages, sectors };
