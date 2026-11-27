import assert from 'node:assert/strict';
import {
  generateSectorMap,
  generateSector,
} from '../../src/client/simulation/sector-generation';
import {
  generateRegion,
  generateStations,
} from '../../src/client/simulation/region-generation';
import { sectorNames, sectorGeneration } from '../../src/specs/sectors';
import { regionSize } from '../../src/specs/region-manager';
import * as Vec from '../../src/client/utilities/vector';

const connected = (
  ids: string[],
  links: ReturnType<typeof generateSectorMap>['links'],
) => {
  const visited = new Set([ids[0]]);

  for (let previous = 0; previous !== visited.size;) {
    previous = visited.size;

    for (const {
      sectors: [a, b],
    } of links) {
      if (!ids.includes(a) || !ids.includes(b)) continue;

      if (visited.has(a)) visited.add(b);

      if (visited.has(b)) visited.add(a);
    }
  }

  assert.equal(visited.size, ids.length, 'all selected sectors are reachable');
};

{
  const worldSeed = 25;
  const world = generateSectorMap({ worldSeed });

  const allLinks = [...world.links, ...world.wormholeLinks];

  connected(
    world.sectors.map(({ id }) => id),
    allLinks,
  );
  connected(world.enabled, allLinks);
  const sites = new Set<string>();

  for (const [links, kind] of [
    [world.links, 'gateSites'],
    [world.wormholeLinks, 'wormholeSites'],
  ] as const) {
    for (const link of links) {
      assert.notEqual(link.sectors[0], link.sectors[1]);

      link.sectors.forEach((id, index) => {
        const site = world.sectors.find((sector) => sector.id === id)![kind][
          link.sites[index]
        ];

        assert(site, 'each endpoint has a generated location');
        assert(
          !sites.has(site.id),
          'a site serves exactly one bidirectional connection',
        );
        sites.add(site.id);
      });
    }
  }

  const extended = generateSectorMap({
    worldSeed,
    names: [...sectorNames, 'Future'],
  });

  assert.deepEqual(
    extended.sectors.slice(0, world.sectors.length),
    world.sectors,
  );
  assert.deepEqual(extended.links.slice(0, world.links.length), world.links);
  assert.deepEqual(
    extended.wormholeLinks.slice(0, world.wormholeLinks.length),
    world.wormholeLinks,
  );
  assert.deepEqual(extended.enabled, world.enabled);
  assert.deepEqual(
    generateSectorMap({ worldSeed, enabledCount: sectorNames.length }).links,
    world.links,
  );
  assert.deepEqual(
    generateSectorMap({ worldSeed, enabledCount: sectorNames.length })
      .wormholeLinks,
    world.wormholeLinks,
  );

  const reordered = generateSectorMap({
    worldSeed,
    names: [...sectorNames].reverse(),
  });

  for (const sector of world.sectors) {
    const other = reordered.sectors.find(({ id }) => id === sector.id)!;
    const { gateSites, wormholeSites, ...geometry } = sector;
    const {
      gateSites: otherGates,
      wormholeSites: otherWormholes,
      ...otherGeometry
    } = other;

    assert.deepEqual(otherGeometry, geometry);

    for (const site of [...gateSites, ...wormholeSites]) {
      const matching = [...otherGates, ...otherWormholes].find(
        ({ id }) => id === site.id,
      );

      if (matching) {
        assert.deepEqual(
          matching,
          site,
          'graph changes never move an existing site',
        );
      }
    }
  }

  const sector = generateSector({ worldSeed, name: 'Patroclus' });

  const station = generateStations({
    worldSeed,
    sector,
    from: Vec.create(-sector.radiusX, -sector.radiusX),
    to: Vec.create(sector.radiusX, sector.radiusX),
  })[0];

  assert(station, 'sample an ordinary station for the region-copy checks');

  const stationCell = Vec.create(
    Math.floor(station.position.x / regionSize),
    Math.floor(station.position.y / regionSize),
  );

  const stationRegion = generateRegion({
    worldSeed,
    sector,
    region: stationCell,
  });

  stationRegion.stations[0].position.x = 999;
  assert.equal(
    generateRegion({ worldSeed, sector, region: stationCell }).stations[0]
      .position.x,
    station.position.x,
  );

  for (const site of [...sector.gateSites, ...sector.wormholeSites]) {
    const at = Vec.create(
      Math.floor(site.position.x / regionSize),
      Math.floor(site.position.y / regionSize),
    );

    for (let x = at.x - 1; x <= at.x + 1; x++) {
      for (let y = at.y - 1; y <= at.y + 1; y++) {
        const description = generateRegion({
          worldSeed,
          sector,
          region: Vec.create(x, y),
        });

        for (const object of [
          ...description.asteroids,
          ...description.stations,
          ...description.wrecks,
        ]) {
          assert(
            Vec.distance(object.position, site.position) >=
              sectorGeneration.gateArrivalDistance +
                sectorGeneration.gateClearance +
                object.radius,
          );
        }
      }
    }
  }
}

const worldSeed = 25;

const withoutGates: ReturnType<typeof generateSector> = {
  ...generateSector({ worldSeed, name: 'Patroclus' }),
  gateSites: [],
};

assert.deepEqual(
  generateStations({
    worldSeed,
    sector: withoutGates,
    from: Vec.create(-withoutGates.radiusX, -withoutGates.radiusY),
    to: Vec.create(withoutGates.radiusX, withoutGates.radiusY),
  }),
  [],
  'sectors without jump gates do not generate stations',
);
