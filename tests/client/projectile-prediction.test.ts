import '../support/ignore-handshake-timeout.ts';
import { execFileSync } from 'node:child_process';
import { runProductionScenario } from '../support/build-plugin';
import { fixtureSource } from '../support/fixture-source';

const root = process.cwd();

const fixtures = JSON.parse(
  execFileSync('src/server/target/debug/examples/projectile_prediction', [], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
);

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    send() {}
  },
});

await runProductionScenario({
  name: 'projectile-prediction',
  modules: {
    '/src/client/audio/sound-loader.ts':
      'export const unlockAudio=()=>{};export const playSound=()=>{};export const updateThrusterSound=()=>{};',
  },
  source: `
import assert from 'node:assert/strict';
import { installExampleModules } from '${root}/tests/support/example-modules.ts';
import { NetworkClient } from '${root}/src/client/network/network.ts';
import { Asteroid } from '${root}/src/client/objects/asteroid.ts';
import { decodeBinarySnapshot } from '${root}/src/client/protocol/binary-snapshot.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';

installExampleModules();
const [impact, drifting, reloaded] = ${fixtureSource(fixtures)};
const decode = hex => decodeBinarySnapshot(Buffer.from(hex, 'hex'));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const asteroids = world => [...world.entities.values()].filter(entity => entity instanceof Asteroid);

function replay({ fixture, delay, start = 0, framesPerTick = 1, pauseAt, visit, setup }) {
  const network = new NetworkClient({ url: 'test' });
  network.receive({ message: {
    type: 'welcome', playerId: 'test', playerNumber: 1, shipId: 1,
    worldSeed: 25, serverTick: start, spawn: { x: 0, y: 0 }, unlockedPaints: [],
  }});
  network.receive({ message: decode(start ? fixture.frames[start - 1].reload : fixture.initial) });
  setup?.(network);

  const step = simulationStep / framesPerTick;
  let now = performance.now() + 100;
  for (let tick = start; tick < fixture.frames.length; tick++) {
    const packet = fixture.frames[tick - delay]?.packet;
    if (packet && tick - delay >= start) network.receive({ message: decode(packet) });

    for (let frame = 0; frame < framesPerTick; frame++) {
      now += step * 1000;
      network.updateFrame({
        input: { ...emptyPlayerInput(), ...fixture.frames[tick].input },
        now,
        dt: tick === pauseAt ? 0 : step,
      });
      const events = network.takeEvents();
      const predicted = network.predictFrame({ now });
      const world = network.world;
      const rendered = network.remoteMotion.sample({ now, world, predicted });
      visit({ tick, predicted, world, rendered, events });
    }
  }
}

// A delayed impact agrees with Rust's contacts and split IDs without
// presenting an explosion, direct hit, or fracture twice.
const expectedHits = impact.frames.flatMap(frame => frame.hits).filter(hit => hit.damage[1] > 0);
const expectedSplits = impact.frames.flatMap(frame => frame.splits);
const impactEvents = [];
replay({
  fixture: impact,
  delay: 3,
  visit({ tick, world, rendered, events }) {
    const frame = impact.frames[tick];
    assert.deepEqual(asteroids(world).map(asteroid => asteroid.id), frame.asteroids);
    for (const asteroid of asteroids(world)) {
      const expected = frame.poses[asteroid.id];
      assert(distance(asteroid.position, expected.Position) < .01, 'server fragment position at tick ' + tick);
      assert(Math.abs(asteroid.rotation - expected.Rotation) < .01, 'server fragment rotation at tick ' + tick);
      assert(distance(rendered.get(asteroid.id).position, expected.Position) < .01, 'fragment renders at its server pose');
    }
    impactEvents.push(...events);
  },
});
const hits = impactEvents.filter(event => event.type === 'collision' && event.damage[1] > 0);
for (const hit of hits) {
  const index = expectedHits.findIndex(expected => expected.a === hit.a && expected.b === hit.b
    && hit.damage.every((amount, i) => Math.abs(amount - expected.damage[i]) < 1e-8)
    && hit.colors.every((color, i) => color === expected.colors[i])
    && distance(hit.position, expected.position) < .01);
  assert(index >= 0, 'each presented contact consumes one matching authoritative hit');
  expectedHits.splice(index, 1);
}
const explosions = impactEvents.filter(event => event.type === 'explosion').map(event => event.objectId);
const splits = impactEvents.filter(event => event.type === 'asteroidSplit').map(event => event.asteroidId);
assert(explosions.length > 0);
assert.equal(new Set(explosions).size, explosions.length);
assert.equal(splits.filter(id => id === 100).length, 1);
assert.equal(new Set(splits).size, splits.length);
assert(splits.every(id => expectedSplits.includes(id)));

function checkPose(actual, displayed) {
  const turn = displayed.rotation - actual.rotation;
  assert(distance(actual.position, displayed.position) < .05, 'fragment correction stays below .05 meters');
  assert(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * actual.radius < .05, 'fragment edge correction stays below .05 meters');
}

// Delayed unseen allocations force an autogun fracture to reuse an ID. A
// pause during the replay must leave each fragment at its own pose.
const firstSplit = drifting.frames.findIndex(frame => frame.splits.includes(100));
assert(firstSplit >= 0, 'autogun splits the drifting triangle');
let replacements = 0;
const geometry = points => JSON.stringify(points?.map(point => point.map(value => Math.round(value * 1e5))));
replay({
  fixture: drifting,
  delay: 8,
  framesPerTick: 4,
  pauseAt: firstSplit + 12,
  setup(network) {
    const correct = network.remoteMotion.correct.bind(network.remoteMotion);
    network.remoteMotion.correct = options => {
      const previousFragments = [...options.before].filter(([id, pose]) => {
        const body = options.predicted.entities.get(id) || options.world.entities.get(id);
        return pose.kind === 'asteroid' && body?.kind === 'asteroid'
          && geometry(pose.shapeOutline) !== geometry(body.shapeOutline);
      });
      correct(options);
      for (const [id] of previousFragments) {
        const displayed = network.remoteMotion.sample(options).get(id);
        const body = options.predicted.entities.get(id) || options.world.entities.get(id);
        assert(distance(displayed.position, body.position) < 1e-8, 'a reused fragment ID drops the old offset');
        assert(Math.abs(displayed.rotation - body.rotation) < 1e-8, 'a reused fragment ID drops the old rotation');
        replacements++;
      }
    };
  },
  visit({ predicted, world, rendered }) {
    for (const [id, displayed] of rendered) {
      const actual = predicted.entities.get(id) || world.entities.get(id);
      if (actual instanceof Asteroid) checkPose(actual, displayed);
    }
  },
});
assert(replacements > 0, 'the delayed replay actually replaces a fragment');

// Reload midway through mining a fractured remainder, then keep firing
// across delayed movement-only and full-physics snapshots.
assert(reloaded.frames.flatMap(frame => frame.splits).length > 3);
replay({
  fixture: reloaded,
  delay: 8,
  start: reloaded.frames.findIndex(frame => frame.reload) + 1,
  framesPerTick: 4,
  visit({ predicted, world, rendered }) {
    const largest = asteroids(world).sort((a, b) => b.mass - a.mass)[0];
    if (largest) checkPose(predicted.entities.get(largest.id) || largest, rendered.get(largest.id));
  },
});
`,
});
