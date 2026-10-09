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
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    send() {}
  },
  localStorage: { getItem: () => null as null, setItem() {} },
  Path2D: class {
    addPath() {}
  },
});

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import {decodeBinarySnapshot} from '${root}/src/client/protocol/binary-snapshot.ts';
import {makeEntity, NetworkClient} from '${root}/src/client/network/network.ts';
import {createWorld} from '${root}/src/client/simulation/world.ts';
import {Ship} from '${root}/src/client/objects/ship.ts';
import {cloneEntity} from '${root}/src/client/simulation/world-state.ts';
import {emptyPlayerInput} from '${root}/src/client/protocol/input.ts';
import {renderUI} from '${root}/src/client/ui/ui.ts';

for(const [shipType,hull,...packets] of Reflect.get(globalThis,'destructionPackets')){
  const world=createWorld();
  const previous=new Map();
  const client=new NetworkClient({url:'test'});
  client.receive({message:{type:'welcome',playerToken:'test',playerId:1,shipId:1,
    worldSeed:25,serverTick:0,spawn:{x:0,y:0}}});
  for(const [stage,hex] of packets.entries()){
    const packet=decodeBinarySnapshot(Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16)));
    if(stage===2&&packet.entityIds?.includes(1)===false){
      client.receive({message:{...packet,type:'snapshot'}});
      assert(!client.shipDestroyed,'receiving a queued death snapshot does not precede the game update');
      client.update({input:emptyPlayerInput(),now:performance.now()+1});
      assert(client.shipDestroyed,'applying the game update detects death');
    }
    client.receive({message:packet});
    assert.equal(client.shipDestroyed,!packet.entityIds.includes(1),'death state matches authoritative membership');
    if(stage===0){
      const ship=client.world.entities.get(1);
      assert(!client.shipStranded,'a fitted thruster prevents manual respawn');
      ship.fit(null,ship.engine.mount);
      assert(client.shipStranded&&!client.shipDestroyed,'losing the thruster leaves a living stranded ship');
      let manualRespawns=0;
      client.send=message=>{if(message.type==='respawn')manualRespawns++;};
      client.requestRespawn();
      assert.equal(manualRespawns,1,'a stranded ship can request respawn');
      ship.dockedTo=2;
      assert(!client.shipStranded,'an empty engine mount in a docking bay is not stranded');
      client.requestRespawn();
      assert.equal(manualRespawns,1,'refitting a docked ship cannot trigger respawn');
      ship.dockedTo=undefined;
      ship.launching=1;
      assert(!client.shipStranded,'launching does not enable manual respawn');
      ship.launching=0;
      ship.remove();
      client.update({input:emptyPlayerInput()});
      assert(client.shipDestroyed,'an update detects an already dead ship without a death packet');
      let respawns=0;
      client.send=message=>{if(message.type==='respawn')respawns++;};
      client.requestRespawn();
      assert.equal(respawns,1,'dead state enables respawn');
      client.receive({message:decodeBinarySnapshot(Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16)))});
      assert(!client.shipDestroyed,'loading a living ship clears dead state');
    }
    if(stage===2&&!packet.entityIds.includes(1)){
      client.receive({message:{type:'welcome',playerToken:'test',playerId:1,shipId:1,
        worldSeed:25,serverTick:packet.serverTick,spawn:{x:0,y:0}}});
      client.receive({message:decodeBinarySnapshot(Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16)))});
      client.update({input:emptyPlayerInput()});
      assert(client.shipDestroyed,'reconnecting dead needs no death event');
    }
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
      if(stage===0){
        const damaged=cloneEntity({entity});
        const health=damaged.hullHealth;
        damaged.hullSegments.forEach((plan,index)=>{if(plan.core)health[index]=0;});
        damaged.playerId=1;
        damaged.hullHealth=health;
        assert(!damaged.cockpit,'hydration has already removed both cores');
        damaged.update(0);
        assert(damaged.dead,'hydrated fatal damage still ends a player ship');
      }
    }
  }
}
for(const uiAlpha of [0,0.25,1]){
  const textAlphas=[];
  const ctx={globalAlpha:0,save(){},restore(){},scale(){},translate(){},strokeText(){textAlphas.push(this.globalAlpha);},fillText(){textAlphas.push(this.globalAlpha);}};
  renderUI({ctx,uiAlpha,uiWidth:800,uiHeight:600,uiScale:1},[],{shipDestroyed:true});
  assert(textAlphas.length>0,'death prompt renders even when the HUD is hidden');
  assert(textAlphas.every(alpha=>alpha===1),'death prompt remains fully visible through the HUD fade');
}
{
  const textAlphas=[];
  const ctx={globalAlpha:0,save(){},restore(){},scale(){},translate(){},strokeText(){textAlphas.push(this.globalAlpha);},fillText(){textAlphas.push(this.globalAlpha);}};
  renderUI({ctx,uiAlpha:0,uiWidth:800,uiHeight:600,uiScale:1},[],{shipDestroyed:false,shipStranded:true});
  assert(textAlphas.length>0&&textAlphas.every(alpha=>alpha===1),'a stranded ship gets a visible respawn hint even with a hidden HUD');
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
