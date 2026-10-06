/* global Buffer, process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const fixtures = JSON.parse(
  execFileSync('go', ['run', 'src/server/testtools/ship-destruction/main.go'], {
    encoding: 'utf8',
    env: { ...process.env, GOEXPERIMENT: 'simd' },
  }),
).map(
  ({ shipType, hull, before, damaged, settled }: Record<string, unknown>) => [
    shipType,
    hull,
    before,
    damaged,
    settled,
  ],
);

Object.assign(globalThis, {
  destructionPackets: fixtures,
  location: { protocol: 'http:', host: 'localhost' },
  WebSocket: class {},
  localStorage: { getItem: () => null as null },
});

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import {decodeBinarySnapshot} from '${root}/src/client/protocol/binary-snapshot.ts';
import {makeEntity} from '${root}/src/client/network/network.ts';
import {createWorld} from '${root}/src/client/simulation/world.ts';
import {Ship} from '${root}/src/client/objects/ship.ts';
import {cloneEntity} from '${root}/src/client/simulation/world-state.ts';

for(const [shipType,hull,...packets] of Reflect.get(globalThis,'destructionPackets')){
  const world=createWorld();
  const previous=new Map();
  for(const [stage,hex] of packets.entries()){
    const packet=decodeBinarySnapshot(Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16)));
    for(const record of packet.fullEntities){
      let entity;
      assert.doesNotThrow(()=>{
        entity=makeEntity({entity:record,world,previous:previous.get(record.id)});
      },shipType+' hull '+hull+' stage '+stage+' hydrates without an incompatible mount');
      previous.set(record.id,entity);
      const copy=cloneEntity({entity});
      assert.doesNotThrow(()=>copy.hitbox(),'prediction can copy damaged ships and wreckage');
      if(!(entity instanceof Ship))continue;
      assert.deepEqual(entity.hullHealth,record.hullHealth.map(health=>health<1?0:health));
      const states=record.modules||[];
      assert.deepEqual(entity.modules.map(module=>module.id),states.map(module=>module.id),
        'surviving module identities and cargo order match the server');
      for(const state of states){
        if(state.mount<0)continue;
        const mount=entity.mounts[state.mount];
        assert.equal(mount.module.id,state.id,'the surviving mount retains its exact module');
        assert(mount.fits.includes(mount.module.constructor),'every mounted module fits its hull');
        assert(!(mount.hull.health<1),'destroyed hulls do not retain mounted modules');
      }
      assert.deepEqual(entity.cargoContents.map(object=>object.id),
        (record.cargoContents||[]).map(object=>states[object.moduleIndex].id),
        'loose modules keep valid cargo indexes when mounted modules disappear');
    }
  }
}
console.log('Go ship destruction snapshots hydrate in source and production');`;

for (const production of [false, true]) {
  const entry = `${root}/src/__ship_destruction_test.ts`;

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'ship-destruction-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : scenario
            : undefined,
        transform: (code, id) =>
          id.endsWith('/src/client/network/network.ts')
            ? code + '\nexport {makeEntity};'
            : undefined,
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
  assert.equal(output[0].type, 'chunk');
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
