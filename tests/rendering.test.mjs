/* global Buffer, process */
import { rolldown } from 'rolldown';
import { minify } from 'terser';
import { terserMangleOptions, viteBuildPre } from '../plugins/vite-build.js';
import { replacePreTerser } from '../plugins/replace-pre-terser.js';

const root = process.cwd();
const fixture = `
import {ReplicationManager} from '${root}/src/server/replication.ts';
import {createWorld,addEntity} from '${root}/src/shared/simulation/world.ts';
import {createShip} from '${root}/src/shared/craft/create-ship.ts';
import {Corral} from '${root}/src/shared/craft/stations/corral.ts';
import {Light,CargoScoop,Horn} from '${root}/src/shared/modules/index.ts';
import {colors} from '${root}/src/shared/colors.ts';
import {Diamond} from '${root}/src/shared/items/diamond.ts';
import {GameObject} from '${root}/src/shared/game-object.ts';
import {createAsteroid,Asteroid} from '${root}/src/shared/simulation/asteroid.ts';
import {mine} from '${root}/src/shared/simulation/mining.ts';
import {Vector} from '${root}/src/shared/vector.ts';
const world=createWorld();
const ship=addEntity(world,createShip(world,{playerId:1,shades:colors.cyan}));
ship.fly(1,0);
ship.setModuleActive({module:Light,active:true});
ship.setModuleActive({module:CargoScoop,active:true});
ship.modules.find(module=>module instanceof Horn).mount.health=2;
ship.update(.1);
ship.cargoContents.push(new Diamond({id:321,health:42}),new Horn({id:322}),new GameObject({id:323,label:'CRATE',health:19}));
addEntity(world,new Corral({world,id:99,shades:colors.white,cargoContents:[new Diamond({id:421}),new Horn({id:422}),new GameObject({id:423})]}));
const packet = new ReplicationManager().initial({world,shipId:ship.id});
const rock=addEntity(world,createAsteroid(world,{id:500,radius:25,radiusEven:12,points:6,resource:1,contents:[1,1,1,1],position:Vector(150)}));
const drill=ship.segments.find(part=>part.module instanceof Horn);
drill.active=1;
drill.activationProgress=.5;
const section=rock.sections[1];
section.health=.5;
const hit=asteroid=>mine({world,events:[],contacts:[{collider:{owner:ship,role:'drill',segment:drill,position:ship.position},other:{owner:asteroid,part:asteroid===rock?section:undefined},depth:1}]});
hit(rock);
if(!world.entities.has(rock.id)||section.health!==.5)throw Error('a drill must spin up before mining');
drill.activationProgress=1;
hit(rock);
if(!rock.dead || world.entities.has(rock.id))throw Error('split must remove its parent');
const children=[...world.entities.values()].filter(entity=>entity instanceof Asteroid);
const loose=children.find(entity=>!entity.sections);
const checkpoint=()=>JSON.parse(JSON.stringify(new ReplicationManager().initial({world,shipId:ship.id}))).fullEntities.filter(entity=>children.some(child=>child.id===entity.id)||entity.kind==='item');
const split=checkpoint();
ship.velocity.set(Vector(300,100));
loose.velocity.set(Vector(5,2));
loose.health=.5;
hit(loose);
if(ship.velocity.distanceTo(Vector(5,2))>1e-9)throw Error('breaking loose must release the mining grip');
export default JSON.stringify({...packet,miningStages:[split,checkpoint()]});
`;
const scenario = `
import assert from 'node:assert/strict';
import {makeEntity} from '${root}/src/client/network.ts';
import {applyEntity} from '${root}/src/client/prediction.ts';
import {game} from '${root}/src/client/game.ts';
import '${root}/src/client/craft/ship.ts';
import '${root}/src/client/craft/station.ts';
import '${root}/src/client/items/item.ts';
import {createWorld} from '${root}/src/shared/simulation/world.ts';
import {cloneEntity} from '${root}/src/shared/simulation/world-state.ts';
import {Mustang} from '${root}/src/shared/craft/ships/mustang.ts';
import {Corral} from '${root}/src/shared/craft/stations/corral.ts';
import {Thruster} from '${root}/src/shared/modules/thruster.ts';
import {Light,CargoScoop,Horn} from '${root}/src/shared/modules/index.ts';
import {Diamond} from '${root}/src/shared/items/diamond.ts';
import {Amethyst} from '${root}/src/shared/items/amethyst.ts';
import {Asteroid} from '${root}/src/shared/simulation/asteroid.ts';
import {Craft} from '${root}/src/shared/craft/craft.ts';
import {createWreckage} from '${root}/src/shared/craft/create-wreckage.ts';
import {Vector} from '${root}/src/shared/vector.ts';
import {renderAsteroid} from '${root}/src/client/render-asteroid.ts';
import {colors} from '${root}/src/shared/colors.ts';
import {renderControls} from '${root}/src/client/ui/controls.ts';
import {presentEvents} from '${root}/src/client/present-events.ts';
const soundCount = globalThis['sounds'].length;
presentEvents({playerId:1,events:[{type:'itemCollected',by:1,itemId:888,resource:0}]});
assert.equal(globalThis['sounds'].length,soundCount+1,'collecting cargo plays a sound');
assert.equal(globalThis['sounds'].at(-1),2,'pickup uses the original pickup effect');
presentEvents({playerId:1,events:[{type:'itemCollected',by:2,itemId:889,resource:0}]});
assert.equal(globalThis['sounds'].length,soundCount+1,'other pilots do not play our cargo notification');
const packet=JSON.parse(globalThis['packet']);
const world=createWorld();
const objects=packet['fullEntities'].map(entity=>makeEntity({entity,world}));
assert.throws(()=>makeEntity({entity:{...packet['fullEntities'][0],['kind']:'unknown'},world}),/Unknown replicated entity kind/,'unknown wire kinds must not turn into ships');
const remote=objects.find(entity=>entity instanceof Mustang);
const station=objects.find(entity=>entity instanceof Corral);
assert(remote && station,'wire descriptions restore concrete classes');
assert(remote.moduleActive({module:Light}) && remote.moduleActive({module:CargoScoop}),'wire activation restores module instances');
assert.deepEqual(remote.shades,colors.cyan,'authoritative ship palette survives the wire');
assert.deepEqual(station.shades,colors.white,'station retains its own palette');
for(const craft of [remote,station]){
  assert.equal(craft.cargoContents.length,3,'mixed cargo replicates without double-counting loose modules');
  assert(craft.cargoContents[0] instanceof Diamond);
  assert(craft.cargoContents[1] instanceof Horn);
  assert(craft.modules.includes(craft.cargoContents[1]),'replicated inventory and cargo reference the same module');
}
assert.deepEqual(remote.cargoContents.map(object=>object.id),[321,322,323],'cargo order and identities survive the wire');
assert.equal(remote.cargoContents[0].health,42,'item damage survives replication');
assert.equal(remote.cargoContents[2].label,'CRATE','generic cargo state survives replication');
for(const craft of [remote,station]){
  const predicted=cloneEntity({entity:craft});
  for(let tick=0;tick<3;tick++)applyEntity({entity:predicted,server:craft});
  assert.deepEqual(predicted.cargoContents.map(object=>object.id),craft.cargoContents.map(object=>object.id),'repeated reconciliation preserves mixed cargo without duplicates');
  assert(predicted.modules.includes(predicted.cargoContents[1]),'reconciliation preserves the cargo/module alias');
}
const draws=[];
const strokes=[];
const styles=[];
const transforms=[];
let saves=0,gradients=0,boxes=0;
game.ctx={
  strokeStyle:'#000',fillStyle:'#000',
  save(){saves++;styles.push({strokeStyle:this.strokeStyle,fillStyle:this.fillStyle});},restore(){saves--;Object.assign(this,styles.pop());},translate(x,y){transforms.push([x,y]);},rotate(angle){transforms.push(angle);},scale(){},
  beginPath(){},arc(){},stroke(){strokes.push(this.strokeStyle);},clip(){},setLineDash(){},
  createLinearGradient(){gradients++;return {addColorStop(){}};},
  createRadialGradient(){return {addColorStop(){}};},
  fill(path){draws.push({path,style:this.fillStyle});},
  fillRect(){boxes++;}
};
Object.assign(game,{uiScale:1,uiWidth:640,uiHeight:480});
const local=cloneEntity({entity:remote});
const physicsPosition=remote.position.add(Vector());
const physicsRotation=remote.rotation;
remote.render({zIndex:0,pose:{position:Vector(123,456),rotation:.75}});
assert.deepEqual(transforms[0],[123,456],'remote hull renders at the buffered position');
assert.equal(transforms[1],.75,'remote hull renders at the buffered rotation');
assert.deepEqual(remote.position,physicsPosition,'presentation never changes collision position');
assert.equal(remote.rotation,physicsRotation,'presentation never changes collision rotation');
for(const ship of [local,remote]){
  assert(!Object.hasOwn(ship,'render'),'rendering lives on the shared class prototype');
  const nozzles=ship.segments.filter(part=>part.module instanceof Thruster);
  draws.length=0;
  for(const part of nozzles)part.module.render({segment:part});
  assert.equal(draws.length,nozzles.length,'each active local/remote nozzle renders a flare');
  assert(draws.every(({path})=>path['vertices'].some(([x])=>x<0)),'flares extend behind the nozzle');
  const lamp=ship.segments.find(part=>part.module instanceof Light);
  const before=gradients;
  lamp.module.render({segment:lamp,craft:ship,scenery:[]});
  assert(gradients>before,'active local/remote light draws a beam gradient');
  const beforeBoxes=boxes;
  renderControls(game,ship);
  assert.equal(boxes-beforeBoxes,2,'hatch and light checkboxes reflect replicated activation');
  draws.length=0;
  const beforeHull=gradients;
  ship.render({zIndex:0});
  assert.equal(gradients,beforeHull,'ship hulls use flat fills');
  assert(draws.some(draw=>draw.style===colors.cyan[1]),'remote hull uses the authoritative colour');
  const drill=ship.segments.find(part=>part.module instanceof Horn);
  draws.length=0;
  strokes.length=0;
  drill.module.render({segment:drill});
  assert(draws.some(draw=>draw.style===colors.yellow[0]),'replicated module damage uses the worn colour');
  assert(strokes.every(color=>color===colors.yellow[2]),'horn outline and flutes retain their colour across parent canvas restore');
  const sounds=globalThis['sounds'];
  const beforeSound=sounds.length;
  ship.updateVisual(1/60);
  assert(sounds.slice(beforeSound).includes(0),'opening a replicated hatch plays its sound');
  ship.setModuleActive({module:CargoScoop,active:false});
  ship.updateVisual(1/60);
  assert(sounds.slice(beforeSound).includes(1),'closing a replicated hatch plays its sound');
}
const before=gradients;
// Global layers must put either ship's horn behind both hulls, irrespective
// of the order the two craft entered the renderer.
const drilling=cloneEntity({entity:remote});
drilling.segments=drilling.segments.filter(segment=>segment.hull || segment.module instanceof Horn);
const receiving=new Mustang({shades:colors.cyan});
const hornPart=drilling.segments.find(segment=>segment.module instanceof Horn);
const hullPart=receiving.segments.find(segment=>segment.hull && Array.isArray(segment.points));
assert(hornPart.zIndex<hullPart.zIndex,'the horn belongs below the hull layer');
for(const craftOrder of [[drilling,receiving],[receiving,drilling]]){
  draws.length=0;
  for(const zIndex of [-1,0,1])for(const craft of craftOrder)craft.render({zIndex});
  const hornIndex=draws.findIndex(draw=>JSON.stringify(draw.path['vertices'])===JSON.stringify(hornPart.points));
  const hullIndex=draws.findIndex(draw=>JSON.stringify(draw.path['vertices'])===JSON.stringify(hullPart.points));
  assert(hornIndex>=0 && hullIndex>hornIndex,'overlapping hulls cover the horn in either craft order');
}
station.render({zIndex:2});
assert(gradients>before,'station hulls retain gradient shading');
const wreck=createWreckage({properties:{shades:colors.cyan,decay:1},parts:[{outline:[[0,0],[20,0],[0,20]],radius:20,offset:Vector(),health:2}]});
draws.length=0;
const beforeWreck=gradients;
for(const zIndex of new Set(wreck.segments.map(segment=>segment.zIndex)))wreck.render({zIndex});
assert(draws.length>0,'bare Craft wreckage retains its own hull rendering');
assert.equal(gradients,beforeWreck,'wreckage does not inherit station gradients');
const diamond=new Diamond();
draws.length=0;
diamond.render();
assert(draws.length>0,'concrete items inherit the Item renderer');
assert.equal(saves,0,'parent renderers balance all canvas state');
for(const [index,stage] of packet['miningStages'].entries()){
  const entities=stage.map(entity=>makeEntity({entity,world}));
  assert(!entities.some(entity=>entity instanceof Craft),'mined loot must never hydrate as a ship or wreck');
  const rocks=entities.filter(entity=>entity instanceof Asteroid);
  assert.equal(rocks.length,index===0?2:1,'split replaces the parent with an arm and remainder');
  for(const asteroid of rocks){
    assert.equal(asteroid.resource,1,'every descendant retains its purple material');
    const predicted=cloneEntity({entity:asteroid});
    predicted.resource=undefined;
    applyEntity({entity:predicted,server:asteroid});
    assert.equal(predicted.resource,1,'reconciliation restores asteroid material');
    renderAsteroid({asteroid:predicted});
    draws.length=0;strokes.length=0;
    predicted.render();
    assert.equal(draws[0].style,colors.purple[1]+'9');
    assert.equal(strokes[0],colors.violet[2]);
    assert.equal(predicted.renderContents.length,predicted.contents.length,'cargo stays visible in a detached leaf');
  }
  if(index===1){
    const loot=entities.filter(entity=>entity instanceof Amethyst);
    assert.equal(loot.length,1,'destroying the arm releases an amethyst, not a Mustang');
    assert.equal(loot[0].velocity.x,5);
    assert.equal(loot[0].velocity.y,2);
  }
}
console.log('Replicated flares, light beams, module checkboxes, palettes and render inheritance passed');
`;

globalThis.canvas = { getContext: () => ({}) };
globalThis.location = { protocol: 'http:', host: 'localhost' };
globalThis.WebSocket = class {};
globalThis.localStorage = { getItem: () => null };
globalThis.sounds = [];
globalThis.Path2D = class {
  constructor() {
    this.vertices = [];
  }
  moveTo(x, y) {
    this.vertices.push([x, y]);
  }
  lineTo(x, y) {
    this.vertices.push([x, y]);
  }
  arc() {}
  closePath() {}
  rect() {}
  addPath() {}
};
for (const mode of ['fixture', 'source', 'production']) {
  const production = mode === 'production';
  const source = mode === 'fixture' ? fixture : scenario;
  const bundle = await rolldown({
    input: 'render-test',
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'render-test',
        resolveId: (id) => (id === 'render-test' ? '\0render-test' : undefined),
        load(id) {
          if (id.endsWith('/src/client/sound-loader.ts'))
            return "export const playSound=value=>globalThis['sounds'].push(value);export const continuousSound=()=>undefined;";
          if (id === '\0render-test')
            return production
              ? replacePreTerser(
                  source.replace(/assert\.(\w+)/g, "assert['$1']"),
                )
              : source;
        },
        transform(code, id) {
          if (id.endsWith('/src/client/network.ts'))
            return code + '\nexport {makeEntity};';
          if (id.endsWith('/src/client/prediction.ts'))
            return code + '\nexport {applyEntity};';
        },
      },
      ...(production ? [viteBuildPre()] : []),
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const code = production
    ? (await minify(output[0].code, terserMangleOptions())).code
    : output[0].code;
  const result = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  if (mode === 'fixture') globalThis.packet = result.default;
}
