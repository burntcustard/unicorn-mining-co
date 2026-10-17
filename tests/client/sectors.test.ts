import assert from 'node:assert/strict';
import {
  generateSectorMap,
  generateSector,
  sectorDensity,
} from '../../src/client/simulation/sector-generation';
import {
  generateRegion,
  generateStations,
  generateFields,
} from '../../src/client/simulation/region-generation';
import { sectorNames, sectorGeneration } from '../../src/specs/sectors';
import { regionSize } from '../../src/specs/region-manager';
import * as Vec from '../../src/client/utilities/vector';
import { sinCos } from '../../src/client/utilities/sin-cos';

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

for (const worldSeed of [0, 25, 52, 4294967295]) {
  const world = generateSectorMap({ worldSeed });

  assert(new Set(world.links.map(({ rotation }) => rotation)).size > 1);
  assert(
    world.links.every(
      ({ rotation }) => rotation >= 0 && rotation < Math.PI * 2,
    ),
    'gate connections have varied rotations within a full turn',
  );

  assert.equal(world.sectors.length, 68);
  assert.equal(world.enabled.length, 20);
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

  const wormholeOnly = world.sectors.filter(
    (sector) => !sector.gateSites.length,
  );

  assert(wormholeOnly.length > 0, 'some sectors require wormhole exploration');

  for (const sector of wormholeOnly) {
    assert.deepEqual(
      generateStations({
        worldSeed,
        sector,
        from: Vec.create(-sector.radiusX * 2, -sector.radiusX * 2),
        to: Vec.create(sector.radiusX * 2, sector.radiusX * 2),
      }),
      [],
      'sectors without Jump Gates have no stations',
    );
  }

  for (const sector of world.sectors) {
    assert(sector.gateSites.length <= 4);
    assert(sector.wormholeSites.length <= 4);
    assert(sector.gateSites.length + sector.wormholeSites.length >= 1);

    if (!sector.gateSites.length) {
      const links = world.wormholeLinks.filter((link) =>
        link.sectors.includes(sector.id),
      );

      assert(links.length >= 1 && links.length <= 4);
    }

    const connections = [...sector.gateSites, ...sector.wormholeSites];

    for (const site of connections) {
      assert(Vec.length(site.position) < 100000);
      assert(Vec.length(site.arrival) < 100000);

      for (const other of connections) {
        if (site === other) continue;
        assert(
          Vec.distance(site.position, other.position) >
            2 *
              (sectorGeneration.gateArrivalDistance +
                sectorGeneration.gateClearance),
          'arrival clearings do not overlap',
        );
      }
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
    generateSectorMap({ worldSeed, enabledCount: 68 }).links,
    world.links,
  );
  assert.deepEqual(
    generateSectorMap({ worldSeed, enabledCount: 68 }).wormholeLinks,
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
  const aligned = { ...sector, rotation: 0 };
  const center = Vec.create();

  assert(sectorDensity({ sector, position: center, kind: 0 }) > 1);
  assert(sectorDensity({ sector, position: center, kind: 1 }) < 1);

  assert(
    sectorDensity({
      sector: aligned,
      position: Vec.create(sector.radiusX, 0),
      kind: 0,
    }) < 0.4,
    'field density falls faster than the original half-density radius',
  );

  const outskirts = Vec.create(sector.radiusX * 2, 0);

  assert.equal(
    sectorDensity({ sector: aligned, position: outskirts, kind: 1 }),
    0,
  );
  assert(sectorDensity({ sector: aligned, position: outskirts, kind: 2 }) > 0);
  assert.equal(
    sectorDensity({ sector: aligned, position: Vec.create(1e9, 1e9), kind: 0 }),
    0.015,
  );

  const station = generateStations({
    worldSeed,
    sector,
    from: Vec.create(-sector.radiusX, -sector.radiusX),
    to: Vec.create(sector.radiusX, sector.radiusX),
  })[0];

  assert(station, 'sample an ordinary station for the region-copy checks');

  const regions = [
    Vec.create(-1, -1),
    Vec.create(),
    Vec.create(3, -4),
    Vec.create(-1000, 1000),
  ];
  const expected = regions.map((region) =>
    generateRegion({ worldSeed, sector, region }),
  );

  for (const region of [...regions].reverse()) {
    assert.deepEqual(
      generateRegion({ worldSeed, sector, region }),
      expected[regions.indexOf(region)],
    );
  }

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

// Exercise random counts and graph repair across many worlds, rather than
// pinning the tuning to particular named sectors.
const totals = {
  gates: 0,
  wormholes: 0,
  small: 0,
  large: 0,
  gateDistance: 0,
  wormholeDistance: 0,
  closeWormholes: 0,
  distantWormholes: 0,
};

for (let worldSeed = 0; worldSeed < 100; worldSeed++) {
  const world = generateSectorMap({ worldSeed });
  const links = [...world.links, ...world.wormholeLinks];

  connected(
    world.sectors.map(({ id }) => id),
    links,
  );
  connected(world.enabled, links);
  const sorted = [...world.sectors].sort((a, b) => a.radiusX - b.radiusX);
  const count = (sectors: typeof sorted) =>
    sectors.reduce(
      (sum, sector) =>
        sum + sector.gateSites.length + sector.wormholeSites.length,
      0,
    );

  totals.small += count(sorted.slice(0, 17));
  totals.large += count(sorted.slice(-17));

  for (const sector of world.sectors) {
    const axis = sinCos({ sin: 0, cos: 0 }, sector.rotation);
    const distance = (position: Vec.Value) =>
      Math.hypot(
        (position.x * axis.cos + position.y * axis.sin) / sector.radiusX,
        (-position.x * axis.sin + position.y * axis.cos) / sector.radiusY,
      );

    totals.gates += sector.gateSites.length;
    totals.wormholes += sector.wormholeSites.length;

    for (const site of [...sector.gateSites, ...sector.wormholeSites]) {
      assert(Vec.length(site.position) < 100000);
      assert(Vec.length(site.arrival) < 100000);
    }

    for (const site of sector.gateSites) {
      totals.gateDistance += distance(site.position);
    }

    for (const site of sector.wormholeSites) {
      const radius = distance(site.position);

      totals.wormholeDistance += radius;

      if (radius < 0.7) totals.closeWormholes++;

      if (radius > 1) totals.distantWormholes++;
    }
  }
}

assert(
  totals.large > totals.small * 1.5,
  'larger sectors have more connections on average',
);
assert(
  totals.gates / totals.wormholes > 0.9 &&
    totals.gates / totals.wormholes < 1.1,
  'both passage types have comparable counts',
);
assert(
  totals.wormholeDistance / totals.wormholes >
    (totals.gateDistance / totals.gates) * 1.25,
  'wormholes favor a wider annulus',
);
assert(
  totals.closeWormholes > 0 && totals.distantWormholes > 0,
  'wormholes can be close or far from the populated center',
);

const sector = generateSector({ worldSeed: 25, name: 'Patroclus' });

const distant = generateRegion({
  worldSeed: 25,
  sector,
  region: Vec.create(648, 533),
});

assert(distant.wrecks.length > 0, 'exercise an actual wreck in sparse space');
assert(
  distant.wrecks.some(({ clueField }) => !clueField),
  'bounded searches allow wrecks without ore clues',
);
assert(distant.wrecks.every(({ cargoContents }) => cargoContents.length > 0));

assert(
  generateFields({
    worldSeed: 25,
    sector,
    from: Vec.create(1e6, 1e6),
    to: Vec.create(1.5e6, 1.5e6),
  }).length > 0,
  'fields remain possible well outside the populated area',
);

console.log(
  'Sector graphs remain connected and stable; density, reserved sites and sparse clue searches behave correctly',
);
