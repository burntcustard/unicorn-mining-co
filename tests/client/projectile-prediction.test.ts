/* global Buffer, process */
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const fixtures = execFileSync(
  'go',
  ['run', 'src/server/testtools/projectile-prediction/main.go'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);
// Fixture keys are properties, while quoted gameplay strings are tags. Keep
// keys unquoted so the production tag rewrite cannot turn "input" into a tag.
const fixtureSource = fixtures.replace(/"([A-Za-z_]\w*)":/g, '$1:');

// NetworkClient also exports the normal singleton; supply browser APIs before
// evaluating either bundle, and drive packet receipt independently of rendering.
Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: {
    setItem() {},
    getItem(): null {
      return null;
    },
  },
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    send() {}
  },
});

const scenario = `
import assert from 'node:assert/strict';
import { NetworkClient } from '${root}/src/client/network/network.ts';
import { decodeBinarySnapshot } from '${root}/src/client/protocol/binary-snapshot.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';
import { Asteroid } from '${root}/src/client/objects/asteroid.ts';
const fixtures = ${fixtureSource};
const decode = hex => decodeBinarySnapshot(Uint8Array.from(Buffer.from(hex, 'hex')));
for (const renderEvery of [1, 8]) for (const delay of [0, 1, 3, 8]) for (const fixture of fixtures.filter(fixture => !fixture.repeated)) {
  // Replaying rotating contacts from binary checkpoints can accumulate tiny
  // rounding differences. These remain far below a visible displacement.
  const tolerance = .01;
  const network = new NetworkClient({ url: 'test' });
  network.receive({ message: {
    type: 'welcome', playerToken: 'test', playerId: 1, shipId: 1,
    worldSeed: 25, serverTick: 0, spawn: { x: 0, y: 0 }, unlockedPaints: [],
  }});
  network.receive({ message: decode(fixture.initial) });
  let replacements=0;
  const geometry=points=>JSON.stringify(points?.map(point=>point.map(value=>Math.round(value*1e5))));
  const correct=network.remoteMotion.correct.bind(network.remoteMotion);
  network.remoteMotion.correct=options=>{
    const replaced=[...options.before].filter(([id,pose])=>{
      const body=options.predicted.entities.get(id)||options.world.entities.get(id);
      return pose.kind==='asteroid' && body?.kind==='asteroid' && geometry(pose.shapeOutline)!==geometry(body.shapeOutline);
    });
    correct(options);
    const displayed=network.remoteMotion.sample({now:options.now,world:options.world,predicted:options.predicted});
    for(const [id]of replaced){
      const body=options.predicted.entities.get(id)||options.world.entities.get(id);
      assert(Math.hypot(displayed.get(id).position.x-body.position.x,displayed.get(id).position.y-body.position.y)<1e-8,'a replacement fragment renders at its own pose immediately, without an inherited correction');
      assert(Math.abs(displayed.get(id).rotation-body.rotation)<1e-8,'a replacement fragment does not inherit rotation from the previous fragment');
      replacements++;
    }
  };
  let now = performance.now() + 1;
  const splits = [];
  const hits = [];
  const explosions = [];
  for (let tick = 0; tick < fixture.frames.length; tick++) {
    const packet = fixture.frames[tick - delay]?.packet;
    if (packet) network.receive({ message: decode(packet) });
    now += simulationStep * 1000;
    if ((tick + 1) % renderEvery) continue;
    // Release on an eight-tick boundary so batched frames send the same inputs as Go.
    network.updateFrame({ input: { ...emptyPlayerInput(), plasmaActive: true, autogunActive: true, fire: tick < 304 }, now, dt: simulationStep * renderEvery });
    if(!fixture.reservesIDs) assert.deepEqual(
      [...network.world.entities.values()].filter(entity => entity instanceof Asteroid).map(entity => entity.id),
      fixture.frames[tick].asteroids,
      fixture.weapon + ': delayed Go deltas must preserve predicted fractures and fragment IDs at tick ' + (tick + 1),
    );
    const rendered = network.remoteMotion.sample({ now, world: network.world, predicted: network.predictFrame({ now }) });
    if(!fixture.reservesIDs) for (const [id, pose] of Object.entries(fixture.frames[tick].poses)) {
      const asteroid = network.world.entities.get(Number(id));
      assert(Math.hypot(asteroid.position.x - pose.Position.x, asteroid.position.y - pose.Position.y) < tolerance, fixture.weapon + ': fragment ' + id + ' has the server position at tick ' + (tick + 1) + ' renderEvery=' + renderEvery + ' delay=' + delay + ' moving=' + fixture.moving + ' actual=' + JSON.stringify(asteroid.position) + ' expected=' + JSON.stringify(pose.Position));
      assert(Math.abs(asteroid.rotation - pose.Rotation) < tolerance, fixture.weapon + ': fragment ' + id + ' has the server rotation at tick ' + (tick + 1));
      const displayed = rendered.get(Number(id));
      assert(Math.hypot(displayed.position.x - pose.Position.x, displayed.position.y - pose.Position.y) < tolerance, fixture.weapon + ': fragment ' + id + ' renders at the server position without a correction offset at tick ' + (tick + 1) + ' renderEvery=' + renderEvery + ' delay=' + delay + ' moving=' + fixture.moving + ' actual=' + JSON.stringify(displayed.position) + ' expected=' + JSON.stringify(pose.Position));
    }
    const events = network.takeEvents();
    explosions.push(...events.filter(event=>event.type==='explosion'));
    splits.push(...events.filter(event => event.type === 'asteroidSplit'));
    hits.push(...events.filter(event => event.type === 'collision' && event.damage[1] > 0));
    if(!fixture.reservesIDs) for (const hit of events.filter(event => event.type === 'collision' && event.damage[1] > 0)) {
      const expected = fixture.frames.flatMap(frame => frame.hits).filter(reported => reported.a === hit.a && reported.b === hit.b && reported.damage[0] === hit.damage[0] && reported.colors[1] === hit.colors[1]).sort((a,b) => Math.hypot(a.position.x-hit.position.x,a.position.y-hit.position.y)-Math.hypot(b.position.x-hit.position.x,b.position.y-hit.position.y))[0];
      assert(expected, 'asteroid and moving fragment hits match the authoritative Go event');
      assert.deepEqual(hit.colors, expected.colors);
      assert(hit.damage.every((amount, index) => Math.abs(amount - expected.damage[index]) < 1e-8));
      assert(Math.hypot(hit.position.x - expected.position.x, hit.position.y - expected.position.y) < tolerance, 'client and server agree on the asteroid contact point');
    }
    network.predictFrame({ now: now + simulationStep * 500 });
  }
  if(fixture.reservesIDs){if(delay===8 && renderEvery===1) assert(replacements>0,'delayed unseen server allocations exercise fragment ID reuse');continue;}
  assert.equal(new Set(explosions.map(event=>event.objectId)).size,explosions.length,'reconciliation never duplicates explosion visuals');
  assert(explosions.length>0,'both weapons present their configured impact effect');
  const directHits=hits.filter(hit=>hit.damage[0]>0);
  assert.equal(new Set(directHits.map(hit => hit.a)).size, directHits.length, 'reconciliation never presents the same direct projectile impact twice');
  const hitKey=hit=>[hit.a,hit.b,hit.damage[0],...hit.colors].join(':');
  const authoritativeHits=fixture.frames.flatMap(frame=>frame.hits).filter(hit=>hit.damage[1]>0);
  for(const key of new Set(hits.map(hitKey))) assert(hits.filter(hit=>hitKey(hit)===key).length<=authoritativeHits.filter(hit=>hitKey(hit)===key).length,'reconciliation does not repeat splash effects');
  const originalSplits = splits.filter(event => event.asteroidId === 100).length;
  if (renderEvery === 1) assert.equal(originalSplits, 1, 'the predicted split is presented once');
  assert(originalSplits <= 1, 'batched authoritative splits must not repeat the predicted effect');
  const authoritativeSplits = fixture.frames.flatMap(frame => frame.splits);
  assert(authoritativeSplits.includes(100), 'the fixed-damage firing sequence actually splits the original asteroid');
  assert.equal(new Set(splits.map(event => event.asteroidId)).size, splits.length, 'subsequent chunk hits do not repeat a split');
  assert(splits.every(event => authoritativeSplits.includes(event.asteroidId)), 'presented splits match authoritative damage and fractures');
}
// Repeated plasma hits used to alternate movement-only snapshot catch-up with
// full physics replay. The remainder visibly reversed its correction whenever
// a push/contact changed motion without changing the reported segment health.
const repeated = fixtures.find(fixture => fixture.repeated);
assert(repeated.frames.flatMap(frame => frame.splits).length > 3, 'the regression mines an already fractured remainder');
for (const start of [0, 241]) for (const framesPerTick of [2, 4]) {
  const network = new NetworkClient({ url: 'test' });
  network.receive({ message: {
    type: 'welcome', playerToken: 'test', playerId: 1, shipId: 1,
    worldSeed: 25, serverTick: start, spawn: { x: 0, y: 0 }, unlockedPaints: [],
  }});
  // A fresh client must also handle fragments created before it joined/reloaded.
  network.receive({ message: decode(start ? repeated.frames[start - 1].reload : repeated.initial) });
  let now = performance.now() + 100;
  let samples = 0, maxDisplacement = 0, maxRotation = 0;
  for (let frame = start * framesPerTick; frame < repeated.frames.length * framesPerTick; frame++) {
    const tick = Math.floor(frame / framesPerTick);
    const packet = repeated.frames[tick - 8]?.packet;
    if (packet && tick - 8 >= start && !(frame % framesPerTick)) network.receive({ message: decode(packet) });
    now += simulationStep * 1000 / framesPerTick;
    network.updateFrame({ input: { ...emptyPlayerInput(), ...repeated.frames[tick].input }, now, dt: simulationStep / framesPerTick });
    network.takeEvents();
    const predicted = network.predictFrame({ now });
    const rendered = network.remoteMotion.sample({ now, world: network.world, predicted });
    const largest = [...network.world.entities.values()].filter(entity => entity instanceof Asteroid).sort((a,b) => b.mass-a.mass)[0];
    if (!largest) continue;
    const actual = predicted.entities.get(largest.id) || largest;
    const displayed = rendered.get(largest.id);
    const displacement = Math.hypot(displayed.position.x-actual.position.x, displayed.position.y-actual.position.y);
    const turn = displayed.rotation-actual.rotation;
    const rotation = Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn))) * largest.radius;
    maxDisplacement = Math.max(maxDisplacement,displacement);
    maxRotation = Math.max(maxRotation,rotation);
    samples++;
  }
  // Allow subpixel contact rounding in the production bundle; the regression
  // previously displaced the remainder by .45 units and its edge by .51.
  assert(maxDisplacement < .05, 'repeated plasma hits must not judder the remainder: reload=' + start + ' displacement=' + maxDisplacement);
  assert(maxRotation < .05, 'repeated plasma hits must not judder the remainder rotation: reload=' + start + ' edge displacement=' + maxRotation);
  assert(samples > 100, 'the moving remainder is checked across repeated hits');
}
// Shoot untouched, rotated triangles from a distance, including rocks that only
// spin and fragments whose IDs compete with unseen server allocations.
for (const fixture of fixtures.filter(fixture => fixture.triangle && fixture.weapon === 'autogun')) for (const delay of [0, 3, 8]) for (const framesPerTick of [2, 4]) {
  assert(fixture.frames.some(frame => frame.splits.includes(100)), 'autogun splits the untouched triangle');
  const network = new NetworkClient({ url: 'test' });
  network.receive({ message: {
    type: 'welcome', playerToken: 'test', playerId: 1, shipId: 1,
    worldSeed: 25, serverTick: 0, spawn: { x: 0, y: 0 }, unlockedPaints: [],
  }});
  network.receive({ message: decode(fixture.initial) });
  let now = performance.now() + 1;
  let displacement = 0, edgeDisplacement = 0;
  const pauseAt = fixture.frames.findIndex(frame => frame.splits.includes(100)) + 12;
  for (let frame = 0; frame < fixture.frames.length * framesPerTick; frame++) {
    const tick = Math.floor(frame / framesPerTick);
    const packet = fixture.frames[tick - delay]?.packet;
    if (packet && !(frame % framesPerTick)) network.receive({ message: decode(packet) });
    now += simulationStep * 1000 / framesPerTick;
    // Let a later snapshot advance the clock after fragments already exist.
    const dt = tick === pauseAt ? 0 : simulationStep / framesPerTick;
    network.updateFrame({ input: { ...emptyPlayerInput(), ...fixture.frames[tick].input }, now, dt });
    network.takeEvents();
    const predicted = network.predictFrame({ now });
    const rendered = network.remoteMotion.sample({ now, world: network.world, predicted });
    for (const [id, pose] of rendered) {
      const entity = predicted.entities.get(id) || network.world.entities.get(id);
      if (!(entity instanceof Asteroid)) continue;
      displacement = Math.max(displacement, Math.hypot(pose.position.x-entity.position.x, pose.position.y-entity.position.y));
      const turn = pose.rotation-entity.rotation;
      edgeDisplacement = Math.max(edgeDisplacement, Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn))) * entity.radius);
    }
  }
  assert(displacement < .05, 'autogun triangle position correction: delay=' + delay + ' drifting=' + fixture.drifting + ' displacement=' + displacement);
  assert(edgeDisplacement < .05, 'autogun triangle rotation correction: delay=' + delay + ' drifting=' + fixture.drifting + ' displacement=' + edgeDisplacement);
}
console.log('Go projectile hits and staggered snapshots preserve predicted asteroid fractures');
`;

const entryId = `${root}/src/__projectile_prediction_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'projectile-prediction-test',
        resolveId: (id) => (id === entryId ? entryId : undefined),
        load(id: string) {
          if (id === entryId) {
            return production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : scenario;
          }

          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return 'export const unlockAudio=()=>{};export const playSound=()=>{};export const updateThrusterSound=()=>{};';
          }
        },
      },
      buildPrePlugin(),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
