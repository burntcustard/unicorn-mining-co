/* global Buffer, process */
import { readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { buildPlugin } from '../../plugins/build-plugins.js';
import { stripIfdef } from '../../plugins/replace-pre-terser.js';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { makeEntity } from '${root}/src/client/network/network.ts';
import { applyEntity } from '${root}/src/client/prediction/prediction.ts';
import { game } from '${root}/src/client/game.ts';
import '${root}/src/client/rendering/craft/ship.ts';
import '${root}/src/client/rendering/craft/station.ts';
import '${root}/src/client/rendering/item.ts';
import { createWorld, addEntity } from '${root}/src/client/simulation/world.ts';
import { captureWorld, cloneEntity, restoreWorld } from '${root}/src/client/simulation/world-state.ts';
import { Ship } from '${root}/src/client/objects/ship.ts';
import { createShip } from '${root}/src/client/objects/create-ship.ts';
import { Station } from '${root}/src/client/objects/station.ts';
import { SearchLight, CargoHatch, HornDrill, ShieldGenerator, thrusters } from '${root}/src/client/objects/modules/index.ts';
import { Item } from '${root}/src/client/objects/item.ts';
import { diamond as diamondDefinition } from '${root}/src/definitions/items/index.ts';

import { amethyst as amethystDefinition } from '${root}/src/definitions/items/index.ts';
import { Asteroid, createAsteroid } from '${root}/src/client/simulation/asteroid.ts';
import { Craft } from '${root}/src/client/objects/craft.ts';
import { createWreckage } from '${root}/src/client/objects/create-wreckage.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';
import { renderAsteroid } from '${root}/src/client/rendering/render-asteroid.ts';
import { revealBuriedItems, tint } from '${root}/src/client/rendering/lighting.ts';
import { colors } from '${root}/src/definitions/colors.ts';
import { renderControls } from '${root}/src/client/ui/controls.ts';
import { presentEvents } from '${root}/src/client/rendering/present-events.ts';
const soundCount = Reflect.get(globalThis, 'sounds').length;
presentEvents({playerId:1,events:[{type:'itemCollected',by:1,itemId:888,resource:0}]});
assert.equal(Reflect.get(globalThis, 'sounds').length,soundCount+1,'collecting cargo plays a sound');
assert.equal(Reflect.get(globalThis, 'sounds').at(-1),2,'pickup uses the original pickup effect');
presentEvents({playerId:1,events:[{type:'itemCollected',by:2,itemId:889,resource:0}]});
assert.equal(Reflect.get(globalThis, 'sounds').length,soundCount+1,'other pilots do not play our cargo notification');
const packet=JSON.parse(Reflect.get(globalThis, 'packet'));
const world=createWorld();
const hydratedSlate=makeEntity({entity:{id:9999,kind:'item',resource:4,message:'GOLD ORE 100/200',position:Vec.create(),radius:8,rotation:0,spin:0},world});
assert.equal(hydratedSlate.message,'GOLD ORE 100/200','the replicated slate keeps its field coordinates');
const objects=packet['fullEntities'].map(entity=>makeEntity({entity,world}));
assert.throws(()=>makeEntity({entity:{...packet['fullEntities'][0],kind:'unknown'},world}),/Unknown replicated entity kind/,'unknown wire kinds must not turn into ships');
const remote=objects.find(entity=>entity instanceof Ship);
const station=objects.find(entity=>entity instanceof Station);
assert(remote && station,'wire descriptions restore concrete classes');
assert(remote.moduleActive({module:SearchLight}) && remote.moduleActive({module:CargoHatch}),'wire activation restores module instances');
assert.deepEqual(remote.shades,colors.cyan,'authoritative ship palette survives the wire');
assert.deepEqual(station.shades,colors.white,'station retains its own palette');
for(const craft of [remote,station]){
  assert.equal(craft.cargoContents.length,3,'mixed cargo replicates without double-counting loose modules');
  assert(craft.cargoContents[0] instanceof Item && craft.cargoContents[0].resource === 0);
  assert(craft.cargoContents[1] instanceof HornDrill);
  assert(craft.modules.includes(craft.cargoContents[1]),'replicated modules and cargo contents reference the same module');
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
let saves=0,gradients=0,boxes=0,clips=0;
game.ctx={
  strokeStyle:'#000',fillStyle:'#000',
  save(){saves++;styles.push({strokeStyle:this.strokeStyle,fillStyle:this.fillStyle});},restore(){saves--;Object.assign(this,styles.pop());},translate(x,y){transforms.push([x,y]);},rotate(angle){transforms.push(angle);},scale(){},
  beginPath(){},arc(){},stroke(){strokes.push(this.strokeStyle);},clip(){clips++;},resetTransform(){},setLineDash(){},
  createLinearGradient(){gradients++;return {stops:[],addColorStop(offset,color){this.stops.push(color);}};},
  createRadialGradient(){return {addColorStop(){}};},
  fill(path,rule){draws.push({path,rule,style:this.fillStyle});},
  fillRect(){boxes++;},
  drawImage(image){assert(image.width>0,'glows use a real canvas after prediction cloning');}
};
Object.assign(game,{scale:1,uiScale:1,uiWidth:640,uiHeight:480});
const local=cloneEntity({entity:remote});
const physicsPosition=Vec.add(remote.position, Vec.create());
const physicsRotation=remote.rotation;
remote.render({zIndex:0,pose:{position:Vec.create(123,456),rotation:.75}});
assert.deepEqual(transforms[0],[123,456],'remote hull renders at the buffered position');
assert.equal(transforms[1],.75,'remote hull renders at the buffered rotation');
assert.deepEqual(remote.position,physicsPosition,'presentation never changes collision position');
assert.equal(remote.rotation,physicsRotation,'presentation never changes collision rotation');
for(const ship of [local,remote]){
  assert(!Object.hasOwn(ship,'render'),'rendering lives on the shared class prototype');
  const nozzles=ship.segments.filter(segment=>thrusters.some(Type=>segment.module instanceof Type));
  draws.length=0;
  for(const segment of nozzles)segment.module.render({segment:segment});
  assert.equal(draws.length,nozzles.length,'each active local/remote nozzle renders a flare');
  assert(draws.every(({path})=>Reflect.get(path, 'vertices').some(([x])=>x<0)),'flares extend behind the nozzle');
  const searchLightSegment=ship.segments.find(segment=>segment.module instanceof SearchLight);
  const before=gradients;
  searchLightSegment.module.render({segment:searchLightSegment,craft:ship,scenery:[]});
  assert(gradients>before,'active local/remote search light draws a beam gradient');
  const beforeBoxes=boxes;
  renderControls(game,ship);
  assert.equal(boxes-beforeBoxes,2,'cargo hatch and search light checkboxes reflect replicated activation');
  draws.length=0;
  const beforeHull=gradients;
  ship.render({zIndex:0});
  assert(gradients>beforeHull,'ship hulls retain gradient shading');
  const cyanTints=Array.from({length:64},(_,i)=>tint(colors.cyan,1,i/63));
  assert(draws.some(draw=>draw.style.stops?.every(stop=>cyanTints.includes(stop))),'remote hull is lit from the authoritative colour');
  const hornDrillSegment=ship.segments.find(segment=>segment.module instanceof HornDrill);
  draws.length=0;
  strokes.length=0;
  hornDrillSegment.module.render({segment:hornDrillSegment});
  assert(draws.some(draw=>draw.style===colors.yellow[0]),'modules are filled with their darkest shade');
  assert(strokes.every(color=>color===colors.yellow[2]),'horn drill shapeOutline and flutes retain their colour across parent canvas restore');
  const hatchDoor=ship.segments.find(segment=>segment.module instanceof CargoHatch && !segment.catches);
  draws.length=0;
  hatchDoor.module.render({segment:hatchDoor});
  assert(draws.some(draw=>draw.style===colors.violet[2]),'attached cargo hatch uses its light shade');
  const sounds=Reflect.get(globalThis, 'sounds');
  const beforeSound=sounds.length;
  ship.updateVisual(1/60);
  assert(sounds.slice(beforeSound).includes(0),'opening a replicated cargo hatch plays its sound');
  ship.setModuleActive({module:CargoHatch,active:false});
  ship.updateVisual(1/60);
  assert(sounds.slice(beforeSound).includes(1),'closing a replicated cargo hatch plays its sound');
}
const shieldCraft=new Ship({shades:colors.cyan});
const shield=new ShieldGenerator();
shieldCraft.fit(shield);
const shieldSegment=shieldCraft.segments.find(segment=>segment.module===shield && !segment.covers);
strokes.length=0;
shield.render({segment:shieldSegment});
assert.equal(strokes.at(-1),colors.violet[2],'the shield generator plus uses its violet shapeOutline colour');
let revealed=0;
const litRock={
  scenery:true,segments:[{}],position:Vec.add(remote.position, Vec.create(60)),rotation:0,radius:20,
  shapeOutline:[[-20,-20],[20,-20],[20,20],[-20,20]],
  renderContents:[{render(){revealed++;}}]
};
const remotePose={position:Vec.create(900,800),rotation:.3};
const remotePrediction=cloneEntity({entity:remote});
const predictedLamp=remotePrediction.segments.find(segment=>segment.module instanceof SearchLight);
const remoteLamp=remote.segments.find(segment=>segment.module instanceof SearchLight);
const reveal=()=>revealBuriedItems({sprites:[remote,litRock],predicted:new Map([[remote.id,remotePrediction]]),poses:new Map([[remote.id,remotePose]])});
transforms.length=0;
const clipsBefore=clips;
reveal();
assert.equal(revealed,1,'an active remote lamp reveals buried cargo');
assert.equal(clips-clipsBefore,2,'the cargo is clipped to the remote beam and rock slice');
assert.deepEqual(transforms[0],[900,800],'the remote light uses its displayed pose');
predictedLamp.activationProgress=0;
reveal();
assert.equal(revealed,1,'the predicted lamp state controls remote cargo reveal');
remoteLamp.activationProgress=0;
predictedLamp.activationProgress=1;
reveal();
assert.equal(revealed,2,'predicted light can reveal cargo while the base sprite is stale');
const before=gradients;
// Global layers must put either ship's horn drill behind both hulls, irrespective
// of the order the two craft entered the renderer.
const drilling=cloneEntity({entity:remote});
drilling.segments=drilling.segments.filter(segment=>segment.hull || segment.module instanceof HornDrill);
const receiving=new Ship({shades:colors.cyan});
const hornDrillSegment=drilling.segments.find(segment=>segment.module instanceof HornDrill);
const hullSegment=receiving.segments.find(segment=>segment.hull && Array.isArray(segment.points));
assert(hornDrillSegment.zIndex<hullSegment.zIndex,'the horn drill belongs below the hull layer');
for(const craftOrder of [[drilling,receiving],[receiving,drilling]]){
  draws.length=0;
  for(const zIndex of [-1,0,1])for(const craft of craftOrder)craft.render({zIndex});
  const hornDrillIndex=draws.findIndex(draw=>JSON.stringify(Reflect.get(draw.path, 'vertices'))===JSON.stringify(hornDrillSegment.points));
  const hullIndex=draws.findIndex(draw=>JSON.stringify(Reflect.get(draw.path, 'vertices'))===JSON.stringify(hullSegment.points));
  assert(hornDrillIndex>=0 && hullIndex>hornDrillIndex,'overlapping hulls cover the horn drill in either craft order');
}
station.render({zIndex:2});
assert(gradients>before,'station hulls retain gradient shading');
// Warm the docking glow before cloning, as rendering does between network ticks.
for(const zIndex of [-3,3])station.render({zIndex});
const predictedStation=cloneEntity({entity:station});
for(const zIndex of [-3,3])predictedStation.render({zIndex});
const stationGlow=station.segments.find(segment=>segment.glow).glow;
assert.equal(predictedStation.segments.find(segment=>segment.glow).glow,stationGlow,'prediction shares the immutable glow definition and its render cache');
game.scale=2;
for(const craft of [predictedStation,station])for(const zIndex of [-3,3])craft.render({zIndex});
game.scale=1;

const wreckage=createWreckage({properties:{shades:colors.cyan,decay:1},segments:[{shapeOutline:[[0,0],[20,0],[0,20]],radius:20,offset:Vec.create(),health:2,fillShade:2}]});
draws.length=0;
const beforeWreck=gradients;
for(const zIndex of new Set(wreckage.segments.map(segment=>segment.zIndex)))wreckage.render({zIndex});
assert(draws.length>0,'bare Craft wreckage retains its own hull rendering');
assert(draws.some(draw=>draw.style===colors.cyan[2]),'detached wreckage keeps its light fill shade');
assert.equal(gradients,beforeWreck,'wreckage does not inherit station gradients');
const diamond=new Item(diamondDefinition, );
const lightWorld=createWorld();
const lightShip=addEntity(lightWorld,createShip(lightWorld,{shades:colors.cyan}));
lightShip.setModuleActive({module:SearchLight,active:true});
lightShip.updateModules(1);
const detachedLight=lightShip.modules.find(module=>module instanceof SearchLight);
const lightCheckpoint=captureWorld({world:lightWorld});
lightShip.detach(detachedLight.mount);
const lightDebris=[...lightWorld.entities.values()].find(entity=>entity!==lightShip && entity.decay);
for(const fragment of [lightDebris,cloneEntity({entity:lightDebris})]){
  const beforeBeam=gradients;
  draws.length=0;
  for(const zIndex of [-3,-2,-1,-.5,0,1,2,3])fragment.render({zIndex,scenery:[]});
  assert.equal(gradients,beforeBeam,'detached modules do not project active beams');
  assert(draws.length>0,'detached modules still draw their fixed debris geometry');
  const beforeReveal=revealed;
  revealBuriedItems({sprites:[fragment,litRock],predicted:new Map(),poses:new Map()});
  assert.equal(revealed,beforeReveal,'detached lights do not reveal buried cargo');
}
restoreWorld({world:lightWorld,state:lightCheckpoint});
assert(lightShip.segments.every(segment=>segment.module),'rollback restores every segment module');
for(const zIndex of [-3,-2,-1,-.5,0,1,2,3])lightShip.render({zIndex,scenery:[]});
draws.length=0;
diamond.render();
assert(draws.length>0,'concrete items inherit the Item renderer');
assert.equal(saves,0,'parent renderers balance all canvas state');
for(const [index,stage] of packet.drillingStages.entries()){
  const entities=stage.map(entity=>makeEntity({entity,world}));
  assert(!entities.some(entity=>entity instanceof Craft),'drilled loot must never hydrate as a ship or wreck');
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
    const origin=Vec.add(predicted.position, Vec.create());
    const cargoPositions=predicted.renderContents.map(item=>Vec.add(item.position, Vec.create()));
    const offset=Vec.create(123,456);
    predicted.render({pose:{position:Vec.add(origin, offset),rotation:predicted.rotation+Math.PI/2}});
    predicted.renderContents.forEach((item,index)=>{
      const relative=Vec.subtract(cargoPositions[index], origin);
      const expected=Vec.add(Vec.add(origin, offset), Vec.create(-relative.y,relative.x));
      assert(Vec.distance(item.position, expected)<1e-8,'buried cargo follows the same interpolated pose as its asteroid');
    });
    assert(Vec.distance(predicted.position, origin)<1e-8,'render poses do not change asteroid physics');
  }
  if(index===1){
    const loot=entities.filter(entity=>entity instanceof Item && entity.resource === 1);
    assert.equal(loot.length,1,'destroying the arm releases an amethyst, not a Ship');
    assert.equal(loot[0].velocity.x,5);
    assert.equal(loot[0].velocity.y,2);
  }
}
const holeWorld=createWorld();
const solid=addEntity(holeWorld,createAsteroid(holeWorld,{radius:150,pointCount:7}));
const pieces=solid.detach({asteroidSegment:solid.segments[0],world:holeWorld});
const remainder=pieces.find(piece=>piece.segments?.length);
const predictedRemainder=cloneEntity({entity:remainder});
applyEntity({entity:predictedRemainder,server:remainder});
assert.equal(predictedRemainder.segments[0].shapeOutline.edges,undefined,'prediction copies polygon points without cached edge marks');
renderAsteroid({asteroid:predictedRemainder});
draws.length=0;
predictedRemainder.render();
const painted=draws[0];
const area=shapeOutline=>Math.abs(shapeOutline.reduce((sum,[x,y],index)=>{
  const [nextX,nextY]=shapeOutline[(index+1)%shapeOutline.length];
  return sum+x*nextY-nextX*y;
},0))/2;
const ringAreas=Reflect.get(painted.path, 'contours').map(area).sort((a,b)=>b-a);
assert.equal(painted.rule,'evenodd','asteroid fill handles interior holes');
assert.equal(ringAreas.length,2,'the renderer draws the outer edge and the drilled hole');
assert(Math.abs(ringAreas[0]-ringAreas[1]-remainder.segments.reduce((sum,segment)=>sum+area(segment.shapeOutline),0))<1e-8,'rendered rock area equals the remaining segments');
console.log('Replicated flares, light beams, module checkboxes, palettes, render inheritance and asteroid holes passed');`;

// Private fields enforce canvas receiver identity, like the browser's DOM getters.
class TestCanvas {
  #width = 0;
  get width() {
    return this.#width;
  }
  set width(value) {
    this.#width = value;
  }
  getContext() {
    return { translate() {}, scale() {}, fill() {} };
  }
}
globalThis.document = {
  createElement: () => new TestCanvas(),
  getElementById: () => null,
};
globalThis.canvas = { getContext: () => ({}) };
globalThis.location = { protocol: 'http:', host: 'localhost' };
globalThis.WebSocket = class {};
globalThis.localStorage = { getItem: () => null };
globalThis.sounds = [];
globalThis.Path2D = class {
  constructor() {
    this.vertices = [];
    this.contours = [];
    this.current = undefined;
  }
  moveTo(x, y) {
    this.current = [];
    this.contours.push(this.current);
    this.lineTo(x, y);
  }
  lineTo(x, y) {
    if (!this.current) {
      this.current = [];
      this.contours.push(this.current);
    }
    this.current.push([x, y]);
    this.vertices.push([x, y]);
  }
  arc() {}
  closePath() {
    this.current = undefined;
  }
  rect() {}
  addPath(other) {
    this.contours.push(
      ...other.contours.map((contour) => contour.map((point) => [...point])),
    );
    this.vertices.push(...other.vertices.map((point) => [...point]));
    this.current = undefined;
  }
};

const fixture = readFileSync('tests/fixtures/rendering.json', 'utf8');

globalThis.packet = fixture;

for (const production of [false, true]) {
  const entry = production ? `${root}/src/__render-test.ts` : 'render-test';
  // The fixed fixture and its consumers share one production property map.
  const source = production
    ? scenario.replace("JSON.parse(Reflect.get(globalThis, 'packet'))", fixture)
    : scenario;
  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'render-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load(id) {
          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return "export const playSound=value=>Reflect.get(globalThis, 'sounds').push(value);export const continuousSound=()=>undefined;";
          }

          if (id === entry) {
            return production
              ? stripIfdef(
                  source.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : source;
          }
        },
        transform(code, id) {
          if (id.endsWith('/src/client/network/network.ts')) {
            return code + '\nexport {makeEntity};';
          }

          if (id.endsWith('/src/client/prediction/prediction.ts')) {
            return code + '\nexport {applyEntity};';
          }
        },
      },
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const code = output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
