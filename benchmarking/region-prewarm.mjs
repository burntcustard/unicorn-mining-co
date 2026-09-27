/* global process, global */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');

    return [key, value];
  }),
);

// Compile in the parent so compiler/native library memory is not charged to
// the measured server process. Every child has a sub-five-minute wall timeout.
if (!options.child) {
  const directory = await mkdtemp(join(tmpdir(), 'unicorn-prewarm-'));

  try {
    const { rolldown } = await import('rolldown');
    const bundle = await rolldown({
      input: 'prewarm-entry',
      platform: 'node',
      plugins: [
        {
          name: 'prewarm-entry',
          // Factory lookups exist only in this experimental bundle.
          transform(code, id) {
            // Removal indexing is now production behavior in every mode.
            if (id.endsWith('/src/shared/collision/game-collisions.ts')) {
              const marker =
                '    const hitbox =\n      entity instanceof Craft';

              assert(code.includes(marker));
              return (
                code
                  .replace(
                    marker,
                    `
    const detached = preparedBodies.get(entity);
    if (!record.fixtures.length && geometrySource &&
        detached?.geometrySource === geometrySource &&
        detached.geometry[0] === entity.mass &&
        detached.geometry[1] === entity.angularInertiaScale) {
      this.world.destroyBody(record.body);
      detached.body.m_world = this.world;
      detached.body.m_destroyed = false;
      // Body destruction leaves the fixture links intact; restore their head
      // and register proxies in original fixture order in the destination world.
      detached.body.m_fixtureList = detached.fixtures.at(-1) || null;
      this.world._addBody(detached.body);
      detached.fixtures.forEach(fixture => fixture.createProxies(this.world.m_broadPhase, detached.body.m_xf));
      this.world.m_newFixture = true;
      this.bodies.set(entity.id, detached);
      preparedBodies.delete(entity);
      return detached;
    }
    const prepared = preparedGeometry.get(entity);
    if (!record.fixtures.length && geometrySource &&
        prepared?.geometrySource === geometrySource &&
        prepared.geometry[0] === entity.mass &&
        prepared.geometry[1] === entity.angularInertiaScale) {
      record.geometry = prepared.geometry;
      record.roundedGeometry = prepared.roundedGeometry || [];
      if (prepared.shapes) {
        const colliders = entity.hitbox();
        record.fixtures = prepared.shapes.map((shape, index) =>
          record!.body.createFixture(shape, {physics: true, userData: colliders[index]}));
      } else record.fixtures = prepared.fixtures.map(({shape, physics, userData}) =>
        record!.body.createFixture(shape, {physics, userData}));
      record.body.m_invMass = prepared.invMass;
      record.body.m_invI = prepared.invI;
      record.body.setProxyRadius(prepared.radius);
      record.geometrySource = geometrySource;
      return record;
    }
` + marker,
                  )
                  .replace(
                    '    const previous = record.geometry;',
                    `
    const previous = record.geometry;
    if (record.roundedGeometry.length !== previous.length) {
      record.roundedGeometry = previous.map(value => Math.round(value * 1e6));
    }`,
                  ) +
                '\nexport const preparedGeometry = new WeakMap<GameObject, any>(); export const preparedBodies = new WeakMap<GameObject, any>();'
              );
            }

            if (!id.endsWith('/src/server/region-manager.ts')) return;
            // This harness owns preparation timing, including its cold mode.
            code = code.replace(
              '    this.regions.preGenerate({ radius: preGeneratedRadius });',
              '',
            );
            const markers = [
              [
                '          Object.assign(\n            createAsteroid',
                '          preparedObjects.get(description.id) || Object.assign(\n            createAsteroid',
              ],
              [
                'const station = createStation(',
                'const station = preparedObjects.get(description.id) || createStation(',
              ],
              [
                'const wreck = Object.assign(',
                'const wreck = preparedObjects.get(description.id) || Object.assign(',
              ],
            ];

            for (const [from, to] of markers) {
              assert(code.includes(from), `Missing prototype marker: ${from}`);
              code = code.replace(from, to);
            }
            return (
              code +
              '\nexport const preparedObjects = new Map<number, GameObject>();'
            );
          },
          resolveId(id) {
            if (id === 'prewarm-entry') return '\0prewarm-entry';

            if (id === 'ws') {
              return {
                id: resolve('node_modules/ws/wrapper.mjs'),
                external: true,
              };
            }
          },
          load: (id) =>
            id === '\0prewarm-entry'
              ? `
          export { RegionManager } from '${resolve('src/shared/simulation/region-manager.ts')}';
          export { GameSession } from '${resolve('src/server/game-session.ts')}';
          export { RegionManager as ServerRegions, preparedObjects } from '${resolve('src/server/region-manager.ts')}';
          export { createWorld, addEntity, entityId } from '${resolve('src/shared/simulation/world.ts')}';
          export { createAsteroid } from '${resolve('src/shared/simulation/asteroid.ts')}';
          export { createStation } from '${resolve('src/shared/craft/create-station.ts')}';
          export { createShip } from '${resolve('src/shared/craft/create-ship.ts')}';
          export { itemTypes, Message } from '${resolve('src/shared/items/index.ts')}';
          export { fieldMessage } from '${resolve('src/shared/simulation/region-generation.ts')}';
          export { GameCollisions, preparedGeometry, preparedBodies } from '${resolve('src/shared/collision/game-collisions.ts')}';
          export { updateWorld } from '${resolve('src/shared/simulation/update-world.ts')}';
          export { regionSize } from '${resolve('src/shared/settings.ts')}';
          export * as Vec from '${resolve('src/shared/vector.ts')}';
        `
              : undefined,
        },
      ],
    });
    const entry = join(directory, 'prewarm.mjs');

    await bundle.write({ file: entry, format: 'esm' });
    await bundle.close();
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        '--max-semi-space-size=16',
        ...(options['old-space']
          ? [`--max-old-space-size=${Number(options['old-space'])}`]
          : []),
        fileURLToPath(import.meta.url),
        ...process.argv.slice(2),
        '--child',
        `--bundle=${entry}`,
      ],
      { encoding: 'utf8', timeout: 290000, maxBuffer: 16 * 1024 * 1024 },
    );

    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');

    if (child.status !== 0) {
      throw new Error(`Prewarm exited ${child.status}: ${child.error || ''}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  if (options['old-space']) {
    assert(
      process.execArgv.includes(
        `--max-old-space-size=${Number(options['old-space'])}`,
      ),
      'Heap budget must reach the child',
    );
  }
  const api = await import(pathToFileURL(options.bundle));
  const radius = Number(options.radius || 50000);
  const mode = options.mode || 'objects';
  const memoryLimit = Number(options['memory-limit'] || 2048);
  const seed = Number(options.seed || 25);

  assert(Number.isFinite(radius) && radius > 0);
  assert(Number.isFinite(memoryLimit) && memoryLimit > 0);
  assert(
    [
      'cold',
      'descriptions',
      'objects',
      'asteroids',
      'hitboxes',
      'fixtures',
      'geometry',
      'bodies',
    ].includes(mode),
  );
  assert(
    !(options.activation && options.flight),
    'Use separate processes for activation and flight',
  );
  const world = api.createWorld({ seed });
  const regions = new api.RegionManager({ worldSeed: seed });
  const descriptions = [];
  const dormant = api.preparedObjects;
  const preparedCollisions = ['fixtures', 'geometry', 'bodies'].includes(mode)
    ? new api.GameCollisions()
    : undefined;
  const counts = {
    regions: 0,
    asteroids: 0,
    stations: 0,
    wrecks: 0,
    objects: 0,
    segments: 0,
  };
  const memory = () =>
    Object.fromEntries(
      Object.entries(process.memoryUsage()).map(([key, value]) => [
        key,
        value / 1024 ** 2,
      ]),
    );
  const report = (stage, extra = {}) => {
    const used = process.cpuUsage(cpu);
    const elapsedMs = performance.now() - start;
    const beforeGcMiB = memory();

    global.gc();
    console.log(
      JSON.stringify({
        stage,
        mode,
        radius,
        seed,
        counts,
        activeEntities: world.entities.size,
        elapsedMs,
        cpuMs: (used.user + used.system) / 1000,
        beforeGcMiB,
        retainedMiB: memory(),
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        heapLimitMiB: getHeapStatistics().heap_size_limit / 1024 ** 2,
        ...extra,
      }),
    );
    start = performance.now();
    cpu = process.cpuUsage();
  };

  global.gc();
  let start = performance.now();
  let cpu = process.cpuUsage();

  report('initial');
  const extent = Math.ceil(radius / api.regionSize);

  for (let x = -extent; mode !== 'cold' && x < extent; x++) {
    for (let y = -extent; y < extent; y++) {
      const nearestX = Math.max(
        x * api.regionSize,
        Math.min(0, (x + 1) * api.regionSize),
      );
      const nearestY = Math.max(
        y * api.regionSize,
        Math.min(0, (y + 1) * api.regionSize),
      );

      if (nearestX ** 2 + nearestY ** 2 >= radius ** 2) continue;
      const region = api.Vec.create(x, y);
      const description = regions.load({ region }).description;

      regions.unload({ region });
      descriptions.push(description);
      counts.regions++;

      for (const kind of ['asteroids', 'stations', 'wrecks']) {
        counts[kind] += description[kind].length;
      }
    }
  }
  report('descriptions');

  if (mode !== 'descriptions' && mode !== 'cold') {
    let limited = false;
    const objectsByKind = { asteroids: 0, stations: 0, wrecks: 0 };

    for (const description of descriptions) {
      const objects = [
        ...description.asteroids.map((source) =>
          api
            .createAsteroid(world, {
              ...source,
              position: api.Vec.clone(source.position),
              velocity: api.Vec.create(),
            })
            .lockGeometry(),
        ),
        ...(['asteroids', 'geometry', 'bodies'].includes(mode)
          ? []
          : description.stations
        ).map((source) =>
          api.createStation({
            id: source.id,
            position: api.Vec.clone(source.position),
            radius: source.radius,
            spin: source.spin,
          }),
        ),
        ...(['asteroids', 'geometry', 'bodies'].includes(mode)
          ? []
          : description.wrecks
        ).map((source) =>
          Object.assign(
            api.createShip(world, {
              id: source.id,
              position: api.Vec.clone(source.position),
            }),
            {
              cargoContents: [
                ...source.cargoContents.map(
                  (resource) =>
                    new api.itemTypes[resource]({
                      world,
                      id: api.entityId(world),
                    }),
                ),
                new api.Message({
                  world,
                  id: api.entityId(world),
                  message: api.fieldMessage(source.clueField),
                }),
              ],
              paint: source.paint,
            },
          ),
        ),
      ];

      for (const kind of ['asteroids', 'geometry', 'bodies'].includes(mode)
        ? ['asteroids']
        : ['asteroids', 'stations', 'wrecks']) {
        objectsByKind[kind] += description[kind].length;
      }

      for (const object of objects) {
        // Deliberately never add these objects to the simulation's active map.
        assert(!dormant.has(object.id), `duplicate procedural ID ${object.id}`);
        dormant.set(object.id, object);
        counts.objects++;
        counts.segments += object.segments?.length || 0;

        if (mode === 'hitboxes') object.hitbox();
        preparedCollisions?.sync(object);

        if (mode === 'geometry' || mode === 'bodies') {
          const record = preparedCollisions.bodies.get(object.id);

          assert(
            record.geometrySource,
            'Only immutable asteroid geometry is prepared',
          );
          const shared = {
            geometrySource: record.geometrySource,
            geometry: record.geometry,
            radius: record.body.proxyRadius,
            invMass: record.body.m_invMass,
            invI: record.body.m_invI,
          };

          if (options['compact-geometry']) {
            const coordinates = new Map();
            // Local immutable shapes repeat many vertices and edge normals.
            // Preserve exact doubles (including signed zero) while sharing them.
            const key = (value) => (Object.is(value, -0) ? '-0' : value);
            const intern = (vector) => {
              let column = coordinates.get(key(vector.x));

              if (!column) coordinates.set(key(vector.x), (column = new Map()));
              const found = column.get(key(vector.y));

              if (found) return found;
              column.set(key(vector.y), vector);
              return vector;
            };
            const shapes = record.fixtures.map((fixture) => {
              assert(fixture.m_physics);
              const shape = fixture.m_shape;

              shape.m_vertices = shape.m_vertices.map(intern);

              if (shape.m_normals) {
                shape.m_normals = shape.m_normals.map(intern);
              }
              return shape;
            });

            api.preparedGeometry.set(object, { ...shared, shapes });
          } else {
            api.preparedGeometry.set(object, {
              ...shared,
              roundedGeometry: record.roundedGeometry,
              fixtures: record.fixtures.map((fixture) => ({
                shape: fixture.m_shape,
                physics: fixture.m_physics,
                userData: fixture.m_userData,
              })),
            });
          }

          if (mode === 'bodies') {
            if (options['compact-geometry']) record.roundedGeometry = [];
            api.preparedGeometry.delete(object);
            api.preparedBodies.set(object, record);
          }
          // Keep immutable shapes and mass data, releasing bodies, proxies and
          // grid membership. Dormant geometry never enters the live solver.
          preparedCollisions.world.destroyBody(record.body);
          preparedCollisions.bodies.delete(object.id);
          const broad = preparedCollisions.world.m_broadPhase;

          broad.updatePairs(() => {});
          broad.m_grid.query(
            { lowerBound: api.Vec.create(), upperBound: api.Vec.create() },
            () => true,
          );
        }
      }

      if (memory().rss > memoryLimit) {
        limited = true;
        break;
      }
    }
    report('objects', {
      limited,
      objectsByKind,
      preparedBodies: preparedCollisions?.bodies.size || 0,
    });
  }
  assert.equal(world.entities.size, 0);
  assert.equal(regions.loadedRegionCount, 0);
  // Retain the pool across both collection and empty-world simulation.
  const probe = dormant.values().next().value;
  const pose = probe && [probe.position.x, probe.position.y, probe.rotation];

  for (let tick = 0; tick < 3600; tick++) {
    api.updateWorld({ world, inputs: new Map() });
  }

  if (probe) {
    assert.deepEqual(
      [probe.position.x, probe.position.y, probe.rotation],
      pose,
    );
  }
  report('dormantTicks', {
    ticks: 3600,
    retainedObjects: dormant.size,
    retainedRegions: descriptions.length,
  });

  if (options.activation) {
    const server = new api.ServerRegions({ worldSeed: seed });

    server.regions = regions;
    const collisions = new api.GameCollisions();
    const syncSamples = [];
    const fixtureSamples = [];
    const activeCounts = [];
    const hash = createHash('sha256');
    let cacheHits = 0;
    let cacheMisses = 0;
    const get = dormant.get.bind(dormant);

    dormant.get = (id) => {
      const object = get(id);

      if (object) cacheHits++;
      else cacheMisses++;
      return object;
    };
    // Three separated observers cross new region boundaries out to 45,000.
    // Direct placement isolates streaming, not real ship flight or transport.

    for (let step = 0; step <= 150; step++) {
      const positions = [0, 1, 2].map((player) => {
        const angle = (player * Math.PI * 2) / 3;

        return api.Vec.create(
          Math.cos(angle) * step * 300,
          Math.sin(angle) * step * 300,
        );
      });
      let mark = performance.now();

      server.sync({ world, positions });
      syncSamples.push(performance.now() - mark);
      mark = performance.now();
      collisions.step({
        entities: [...world.entities.values()],
        previous: new Map(),
        dt: 0,
      });
      fixtureSamples.push(performance.now() - mark);
      activeCounts.push(world.entities.size);
      hash.update(
        JSON.stringify(
          [...world.entities.values()]
            .sort((a, b) => a.id - b.id)
            .map((object) => [
              object.id,
              object.kind,
              object.position,
              object.rotation,
              object.mass,
              object.segments?.map(
                (segment) => segment.shapeOutline || segment.points,
              ),
            ]),
        ),
      );
    }
    const stats = (values) => {
      const sorted = [...values].sort((a, b) => a - b);

      return {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: sorted.at(-1),
      };
    };

    report('activation', {
      observerCount: 3,
      samples: syncSamples.length,
      syncMs: stats(syncSamples),
      fixtureMs: stats(fixtureSamples),
      syncSamples,
      fixtureSamples,
      activeCounts,
      cacheHits,
      cacheMisses,
      hash: hash.digest('hex'),
      maxActive: Math.max(...activeCounts),
    });
    const removals = [...world.entities.keys()].slice(0, 25);
    const removalSamples = [];

    for (const id of removals) {
      const mark = performance.now();

      regions.remove({ id });
      removalSamples.push(performance.now() - mark);
    }
    report('sourceRemoval', {
      samples: removals.length,
      removalMs: stats(removalSamples),
    });
  }

  if (options.flight) {
    await new Promise((resolve) =>
      setTimeout(resolve, Number(options.cooldown || 1000)),
    );
    assert(
      ['cold', 'descriptions', 'asteroids', 'geometry', 'bodies'].includes(
        mode,
      ),
      'Flight comparison keeps station/wreck ID allocation on demand',
    );
    const scenarios = {
      spread: {
        positions: [
          [-3727, -8190],
          [-8650, -19969],
          [4500, 6500],
        ],
        rotations: [-1.5, 0.3, 2],
      },
      convoy: {
        positions: [
          [-3727, -8190],
          [-3427, -8190],
          [-3127, -8190],
        ],
        rotations: [-1.5, -1.5, -1.5],
      },
      contact: {
        positions: [
          [-3814, -10013],
          [-3614, -9813],
          [-3414, -9613],
        ],
        rotations: [-1.713, -1.713, -1.713],
      },
    };
    const scenario = scenarios[options.scenario || 'spread'];

    assert(scenario);
    const session = new api.GameSession({ worldSeed: seed });

    session.regions.regions = regions;
    let cacheHits = 0;
    const get = dormant.get.bind(dormant);

    dormant.get = (id) => {
      const object = get(id);
      // Consume pristine instances once. Re-visits retain current server
      // semantics rather than silently resurrecting a modified cached body.

      if (object) {
        cacheHits++;
        dormant.delete(id);
      }
      return object;
    };
    let recording = false,
      packets = 0,
      bytes = 0;
    const hash = createHash('sha256');
    const sockets = [0, 1, 2].map(() => ({
      readyState: 1,
      bufferedAmount: 0,
      send(packet) {
        if (recording) {
          hash.update(packet);
          packets++;
          bytes += packet.length;
        }
      },
      close() {},
      terminate() {},
    }));

    sockets.forEach((socket) =>
      session.receive({
        socket,
        message: { type: 'hello', playerToken: null },
      }),
    );
    const players = [...session.players.values()];

    players.forEach((player, index) => {
      [player.ship.position.x, player.ship.position.y] =
        scenario.positions[index];
      player.ship.rotation = scenario.rotations[index];
    });
    const sequences = [0, 0, 0];
    const steer = (tick) =>
      players.forEach((player, index) => {
        const phase = (tick + index * 100) % 600;
        const input = {
          ...player.lastInput,
          thrust: 1,
          turn: phase < 20 ? (Math.floor(tick / 600) % 2 ? 1 : -1) : 0,
        };

        if (tick === 0 || input.turn !== player.lastInput.turn) {
          session.receive({
            socket: sockets[index],
            message: {
              type: 'input',
              tick: session.world.tick,
              sequence: ++sequences[index],
              input,
            },
          });
        }
      });

    for (let tick = 0; tick < 300; tick++) {
      steer(tick);
      session.tick();
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Number(options.cooldown || 1000)),
    );
    recording = true;
    start = performance.now();
    cpu = process.cpuUsage();
    const ticks = 3600,
      samples = [];
    let maxActive = 0;

    for (let tick = 0; tick < ticks; tick++) {
      steer(tick + 300);
      const mark = performance.now();

      session.tick();
      samples.push(performance.now() - mark);
      maxActive = Math.max(maxActive, session.world.entities.size);
    }
    const used = process.cpuUsage(cpu),
      elapsed = performance.now() - start;

    samples.sort((a, b) => a - b);
    report('flight', {
      scenario: options.scenario || 'spread',
      players: 3,
      ticks,
      cpuPerTickMs: (used.user + used.system) / 1000 / ticks,
      wallPerTickMs: elapsed / ticks,
      p50: samples[Math.floor(ticks * 0.5)],
      p95: samples[Math.floor(ticks * 0.95)],
      max: samples.at(-1),
      maxActive,
      flightActiveEntities: session.world.entities.size,
      positions: players.map((player) => ({ ...player.ship.position })),
      cacheHits,
      remainingPrepared: dormant.size,
      packets,
      bytes,
      hash: hash.digest('hex'),
    });
  }

  if (options.validate) {
    assert(
      ['geometry', 'bodies'].includes(mode),
      'Lifecycle validation exercises prepared geometry',
    );
    const server = new api.ServerRegions({ worldSeed: seed });

    server.regions = regions;
    const target = [...dormant.values()].find((object) =>
      object.segments.some((segment) => segment.contents.length),
    );

    assert(target);
    const position = api.Vec.clone(target.position);
    const get = dormant.get.bind(dormant);

    dormant.get = (id) => {
      const found = get(id);

      if (found) dormant.delete(id);
      return found;
    };
    const cached =
      api.preparedGeometry.get(target) || api.preparedBodies.get(target);
    const expectedShape =
      cached.shapes?.[0] ||
      cached.fixtures[0].shape ||
      cached.fixtures[0].m_shape;

    server.sync({ world, positions: [position] });
    assert.equal(world.entities.get(target.id), target);
    const solver = new api.GameCollisions();

    solver.step({
      entities: [...world.entities.values()],
      previous: new Map(),
      dt: 0,
    });
    assert.equal(
      solver.bodies.get(target.id).fixtures[0].m_shape,
      expectedShape,
      'activation reuses the prepared shape',
    );

    if (mode === 'bodies') {
      assert.equal(solver.bodies.get(target.id).body, cached.body);
    }
    let activeBodies = 0;

    for (let body = solver.world.m_bodyList; body; body = body.m_next) {
      activeBodies++;
    }
    assert.equal(
      activeBodies,
      world.entities.size,
      'dormant bodies are absent from the active solver',
    );
    const edited = [...world.entities.values()].find(
      (object) =>
        object !== target && object.segments && object.kind === 'asteroid',
    );

    assert(edited);
    const oldFixture = solver.bodies.get(edited.id).fixtures[0];

    edited.mass++;
    solver.step({
      entities: [...world.entities.values()],
      previous: new Map(),
      dt: 0,
    });
    assert.notEqual(solver.bodies.get(edited.id).fixtures[0], oldFixture);
    assert.equal(solver.bodies.get(edited.id).body.m_invMass, 1 / edited.mass);
    const changedMass = solver.bodies.get(edited.id).fixtures[0];

    edited.segments[0] = {
      ...edited.segments[0],
      shapeOutline: edited.segments[0].shapeOutline.map((point) => [...point]),
    };
    edited.segments[0].shapeOutline[0][0] += 1;
    solver.step({
      entities: [...world.entities.values()],
      previous: new Map(),
      dt: 0,
    });
    assert.notEqual(
      solver.bodies.get(edited.id).fixtures[0],
      changedMass,
      'geometry edits invalidate prepared data',
    );
    target.friction = 0.73;
    assert.equal(
      solver.bodies.get(target.id).fixtures[0].getUserData().friction,
      0.73,
    );
    const segment = target.segments.find((segment) => segment.contents.length);

    segment.health = 0;
    const events = [];

    target.fracture({ asteroidSegment: segment, by: 7, events, world });
    assert(!world.entities.has(target.id));
    const split = events.find((event) => event.type === 'asteroidSplit');

    assert(split);
    const children = split.childIds.map((id) => world.entities.get(id));
    const leaf = children.find((child) => child.contents.length);

    assert(leaf);
    leaf.health = 0;
    const before = new Set(world.entities.keys());

    leaf.fracture({ by: 7, events, world });
    const item = [...world.entities.values()].find(
      (object) => !before.has(object.id),
    );

    assert(item);
    server.sync({ world, positions: [position] });
    assert(
      !server.regions
        .query({ position })
        .asteroids.some((source) => source.id === target.id),
    );
    solver.step({
      entities: [...world.entities.values()],
      previous: new Map(),
      dt: 0,
    });
    assert(
      !solver.bodies.has(target.id),
      'mining removes the prepared parent body',
    );
    const ship = api.addEntity(world, api.createShip(world, { playerId: 7 }));
    const mouthPart = ship.segments.find((segment) => segment.catches);

    ship.segments
      .filter((segment) => segment.module === mouthPart.module)
      .forEach((segment) => {
        segment.active = 1;
        segment.activationProgress = 1;
      });
    const mouth = ship
      .hitbox()
      .find((collider) => collider.segment === mouthPart);
    const crossingY = mouth.position.y - 10;

    api.Vec.setXY(item.position, mouth.position.x - 25, crossingY);
    const contacts = new api.GameCollisions().step({
      entities: [ship, item],
      previous: new Map([
        [
          item.id,
          {
            position: api.Vec.create(mouth.position.x + 25, crossingY),
            rotation: 0,
          },
        ],
      ]),
      dt: 1 / 30,
    });

    ship.handleContacts({ contacts, events, world, dt: 1 / 30 });
    assert(ship.cargoContents.includes(item), 'a mined item enters cargo');
    assert(!world.entities.has(item.id));
    server.sync({ world, positions: [] });
    server.sync({ world, positions: [position] });
    assert(
      !world.entities.has(target.id),
      'the cached parent stays destroyed after leaving and returning',
    );
    assert(
      !world.entities.has(leaf.id),
      'the destroyed fragment stays destroyed',
    );
    assert(!world.entities.has(item.id), 'collected cargo does not respawn');
    assert(ship.cargoContents.includes(item));
    assert(
      children
        .filter((child) => child !== leaf)
        .every((child) => world.entities.get(child.id) === child),
    );
    const markerOnly = new api.RegionManager({ worldSeed: seed });
    const origin = api.Vec.create();
    const marker = markerOnly
      .query({ position: origin })
      .stationMarkers.find(
        (source) =>
          !markerOnly.loaded.has(
            `${Math.floor(source.position.x / api.regionSize)},${Math.floor(source.position.y / api.regionSize)}`,
          ),
      );

    assert(marker);
    markerOnly.remove({ id: marker.id });
    markerOnly.load({
      region: api.Vec.create(
        Math.floor(marker.position.x / api.regionSize),
        Math.floor(marker.position.y / api.regionSize),
      ),
    });
    assert(
      !markerOnly
        .query({ position: origin })
        .stationMarkers.some((source) => source.id === marker.id),
      'a removed marker-only station stays removed after loading its region',
    );
    report('lifecycle', {
      minedParent: target.id,
      collectedItem: item.id,
      assertionsPassed: true,
    });
  }

  if (preparedCollisions) {
    assert.equal(
      preparedCollisions.bodies.size,
      mode === 'fixtures' ? counts.objects : 0,
    );
  }
}
