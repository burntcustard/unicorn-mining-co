/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { effects, addEffect, updateEffects, renderEffects } from '${root}/src/client/effects/effect.ts';
import { explode } from '${root}/src/client/objects/explosion.ts';
import { GameObject } from '${root}/src/client/objects/game-object.ts';
import { createWorld, addEntity } from '${root}/src/client/simulation/world.ts';
import { presentEvents } from '${root}/src/client/effects/present-events.ts';
import { sparks, sprayDamage, updateSparks } from '${root}/src/client/effects/shrapnel.ts';
import { objectLineWidth } from '${root}/src/client/utilities/drawing.ts';
globalThis.Path2D=class { points=[]; lineTo(x,y){this.points.push([x,y]);} closePath(){} };

// Synthetic specs keep visual design choices out of renderer contracts.
const spec=[
  {type:'glow',color:'#f80',radius:20,duration:200,delay:20,alpha:.6,fadeDuration:50,scale:[0,1]},
  {type:'ring',color:'#0cf',radius:40,duration:200,delay:20,alpha:.8,scale:[0,1],easeOut:2,lineWidth:4,endLineWidth:0},
  {type:'polygon',color:'#44f',radius:10,pointCount:4,duration:200,delay:20,alpha:.5,fadeDuration:100,scale:[1,2]},
  {type:'polygon',color:'#fff',radius:5,pointCount:4,duration:20},
  {type:'ring',color:'#ff0',radius:6,duration:10,delay:0,alpha:0,fadeDuration:0},
  {type:'glow',color:'#f00',radius:8,duration:100,delay:250,alpha:.25},
];
const position={x:10,y:20};
addEffect({position,effect:spec,rotation:0,scale:2});
position.x=90;
const effect=effects[0], polygons=effect.parts.filter(part=>part.type==='polygon'), path=polygons[0].path;
assert.equal(effect.position.x,10,'visuals retain their original world position');
assert.equal(effect.rotation,0,'explicit zero rotation is preserved');
assert.equal(effect.duration,350,'lifetime includes the last delayed layer');
assert.equal(polygons[1].path,path,'different radii share the same normalized outline');
assert.equal(path.points.length,8,'four tips alternate with four inward corners');
for(const [index,point] of path.points.entries()){
  const radius=Math.hypot(...point);
  assert(radius<=1 && radius>=(index%2?.8:.2));
  assert.equal(radius>.25,index%2===1,'normalized geometry preserves inner and outer corners');
}
const record=(rotation=0)=>{
  const arcs=[],clips=[],rects=[],fills=[],strokes=[],gradients=[],stack=[];
  const ctx={
    globalAlpha:.75,fillStyle:'#fff',strokeStyle:'#abc',lineWidth:3,size:1,
    save(){stack.push([this.globalAlpha,this.fillStyle,this.strokeStyle,this.lineWidth,this.size]);},
    restore(){[this.globalAlpha,this.fillStyle,this.strokeStyle,this.lineWidth,this.size]=stack.pop();},
    translate(x,y){assert.equal(x,10);assert.equal(y,20);},
    rotate(angle){assert.equal(angle,rotation);},
    scale(x,y){assert.equal(x,y);this.size*=x;},beginPath(){},
    arc(x,y,radius){arcs.push(radius*this.size);},
    clip(path){clips.push(path);},
    rect(...bounds){rects.push(bounds);},
    fill(path){fills.push({path,color:this.fillStyle,alpha:this.globalAlpha,size:this.size});},
    stroke(){strokes.push({radius:arcs.at(-1),color:this.strokeStyle,alpha:this.globalAlpha,width:this.lineWidth*this.size});},
    createRadialGradient(x0,y0,r0,x1,y1,radius){
      const stops=[];
      const gradient={radius:radius*this.size,stops,addColorStop(offset,color){stops.push([offset,color]);}};
      gradients.push(gradient);return gradient;
    }
  };
  renderEffects({ctx});
  assert.equal(ctx.globalAlpha,.75,'rendering restores canvas state');
  assert.equal(ctx.fillStyle,'#fff');assert.equal(ctx.strokeStyle,'#abc');assert.equal(ctx.lineWidth,3);assert.equal(ctx.size,1);
  assert.equal(stack.length,0,'each layer restores its transform');
  return {arcs,clips,rects,fills,strokes,gradients};
};
const advanceTo=(age)=>{
  updateEffects(age-effect.age);
  return record();
};
let frame=record();
assert.deepEqual(frame.fills,[{path,color:'#fff',alpha:1,size:10}],'default layers have constant size and opacity');
assert.deepEqual(frame.strokes,[{radius:12,color:'#ff0',alpha:0,width:objectLineWidth*2}],'zero alpha and fade are preserved; ring width defaults to the object outline');
assert.equal(frame.gradients.length,0,'delayed glows do not appear early');
frame=advanceTo(10);
assert.equal(frame.strokes.length,0,'layers expire independently');
frame=advanceTo(20);
assert.deepEqual(frame.fills,[{path,color:'#44f',alpha:.5,size:20}]);
assert.equal(frame.strokes.length,0,'zero-radius layers do not draw');
assert.equal(frame.gradients.length,0);
frame=advanceTo(70);
assert.equal(frame.strokes[0].radius,35,'ease-out expansion is faster at the start');
assert.equal(frame.strokes[0].width,6,'ring width thins independently of radius easing');
assert.equal(frame.strokes[0].alpha,.8,'thinning does not require fading');
assert.equal(frame.gradients[0].radius,10,'glows use the same scale interpolation as other layers');
assert.deepEqual(frame.gradients[0].stops,[[0,'#f80'],[1,'#ff880000']], 'glows fade to transparent without changing their colour');
assert.equal(frame.fills[1].size,25,'polygon scale combines radius, layer animation and instance scale');
frame=advanceTo(170);
assert.equal(frame.fills[0].alpha,.6);
assert.equal(frame.fills[1].alpha,.25,'fade duration is independent of size animation');
frame=advanceTo(195);
assert.equal(frame.fills[0].alpha,.3);
assert.equal(frame.strokes[0].alpha,.8);
assert.equal(frame.strokes[0].width,1);
assert.equal(polygons[0].path,path,'animation never regenerates geometry');
frame=advanceTo(220);
assert.equal(frame.fills.length+frame.strokes.length,0,'expired layers do not render during a timing gap');
assert.equal(effects.length,1);
frame=advanceTo(275);
assert.equal(frame.fills.length,1);
assert.equal(frame.gradients[0].radius,16,'default glow size stays constant');
assert.equal(frame.fills[0].alpha,.25);
updateEffects(75);assert.equal(effects.length,0);

// Attached bursts follow the displayed ship pose; impact effects stay in place.
const parent={id:7,position:{x:100,y:200},rotation:0};
const offset={x:12,y:-4};
const attachedSpec=[{type:'glow',color:'#fff',radius:5,duration:100}];
addEffect({parent,position:offset,rotation:.25,effect:attachedSpec});
addEffect({position:{x:10,y:20},rotation:0,effect:attachedSpec});
offset.x=90;
const attached=effects[0];
const drawAttached=(poses)=>{
  const draws=[],stack=[];
  let x=0,y=0,angle=0;
  renderEffects({poses,ctx:{
    save(){stack.push([x,y,angle]);},
    restore(){[x,y,angle]=stack.pop();},
    translate(dx,dy){
      x+=dx*Math.cos(angle)-dy*Math.sin(angle);
      y+=dx*Math.sin(angle)+dy*Math.cos(angle);
    },
    rotate(turn){angle+=turn;},
    scale(){},beginPath(){},fill(){},
    arc(){draws.push([x,y,angle]);},
    createRadialGradient(){return {addColorStop(){}};},
  }});
  assert.equal(stack.length,0);
  assert.deepEqual(draws[1],[10,20,0],'unattached impacts retain their world transform');
  return draws[0];
};
const atMuzzle=(actual,expected)=>assert(actual.every((value,index)=>Math.abs(value-expected[index])<1e-9));
atMuzzle(drawAttached(),[112,196,.25]);
parent.position={x:200,y:300};parent.rotation=Math.PI/2;
updateEffects(25);
atMuzzle(drawAttached(),[204,312,Math.PI/2+.25]);
const poses=new Map([[parent.id,{position:{x:500,y:600},rotation:Math.PI}]]);
atMuzzle(drawAttached(poses),[488,604,Math.PI+.25]);
atMuzzle(drawAttached(new Map()),[204,312,Math.PI/2+.25]);
assert.equal(attached.age,25,'rendering attached effects does not advance or restart them');
assert.deepEqual(attached.position,{x:12,y:-4},'the local muzzle offset is copied once');
updateEffects(75);assert.equal(effects.length,0,'attachment does not extend effect lifetime');

// All shapes accept eased shrinking, and zero-width rings stay invisible.
for(const type of ['polygon','ring','glow']){
  addEffect({position:{x:10,y:20},rotation:0,effect:[{type,color:'#fff',radius:8,pointCount:5,radiusEven:4.8,duration:100,scale:[1,0],easeOut:2}]});
  const instance=effects[0];
  assert.equal(instance.scale,1,'instance scale defaults to one');
  if(type==='polygon'){
    const points=instance.parts[0].path.points;
    assert.equal(points.length,10);
    assert(points.every((point,index)=>Math.hypot(...point)>=(index%2?.8:.48)),'radiusEven sets the alternate corner radius in the same units as radius');
  }
  updateEffects(50);frame=record();
  assert.equal(type==='polygon'?frame.fills[0].size:type==='ring'?frame.strokes[0].radius:frame.gradients[0].radius,2);
  updateEffects(50);assert.equal(effects.length,0);
}
addEffect({position:{x:10,y:20},rotation:0,effect:[{type:'ring',color:'#fff',radius:10,duration:10,lineWidth:0,endLineWidth:0}]});
assert.equal(record().strokes.length,0,'Canvas must never receive a zero line width');
updateEffects(10);
addEffect({position:{x:10,y:20},effect:[]});
assert(effects[0].rotation>=0 && effects[0].rotation<Math.PI*2,'omitted rotation is randomized');
updateEffects(0);assert.equal(effects.length,0,'empty effects expire immediately');

// Each burst varies angular spacing without crossing tips or narrowing its fan.
const fanSamples=[], fanRandom=Math.random;
for(const value of [.25,.75]){
  Math.random=()=>value;
  addEffect({position:{x:10,y:20},rotation:0,effect:[{type:'polygon',color:'#fff',radius:10,radiusEven:7.5,pointCount:4,duration:100,spread:Math.PI}]});
  const points=effects[0].parts[0].points;
  assert.equal(points.length,10,'four complete tips have inward corners at both edges and close at the muzzle');
  assert.deepEqual(points.at(-1),[0,0]);
  const angles=points.slice(0,-1).map(([x,y])=>Math.atan2(y,x));
  assert.equal(angles[0],-Math.PI/2);
  assert.equal(angles.at(-1),Math.PI/2);
  const tips=angles.filter((_,index)=>index%2===1);
  assert.equal(tips.length,4);
  assert(tips.every(angle=>angle>-Math.PI/2 && angle<Math.PI/2),'neither fan boundary cuts an outer tip in half');
  const path=effects[0].parts[0].path.points;
  for(const index of [0,points.length-2])
    assert(Math.abs(Math.hypot(...path[index])/Math.hypot(...points[index])-.75)<1e-10,'both fan boundaries end at inward corners');
  assert(angles.every((angle,index)=>index===0 || angle>angles[index-1]),'random angular spacing preserves polygon vertex order');
  fanSamples.push(angles);
  Math.random=()=>{throw new Error('Rendering must not reroll the fan');};
  record();updateEffects(50);record();
  updateEffects(50);
}
Math.random=fanRandom;
assert.notDeepEqual(fanSamples[0],fanSamples[1],'different shots vary their tip angles as well as their lengths');

// Dissolving polygons reveal their centre while keeping their stable outline.
addEffect({position:{x:10,y:20},rotation:0,effect:[{type:'polygon',color:'#fff',radius:10,pointCount:5,duration:200,delay:20,dissolveDuration:100}]});
const dissolvingPath=effects[0].parts[0].path;
updateEffects(120);frame=record();
assert.equal(frame.clips.length,0,'the polygon stays solid until its final dissolve interval');
assert.equal(frame.fills[0].path,dissolvingPath);
updateEffects(50);frame=record();
assert.deepEqual(frame.clips,[dissolvingPath],'the hole is clipped to the original polygon');
assert.deepEqual(frame.arcs,[5],'the hole grows in normalized polygon space');
assert.deepEqual(frame.rects,[[-1,-1,2,2]],'the fill covers the normalized outline');
assert.equal(frame.fills[0].path,'evenodd','the centre is excluded without clearing the scene');
assert.equal(frame.fills[0].alpha,1,'dissolve does not require opacity fading');
updateEffects(49);frame=record();
assert.equal(frame.arcs[0],9.9,'the hole approaches the outer tips before expiry');
updateEffects(1);assert.equal(effects.length,0);

// Animated alternate radii keep their random geometry and work with dissolve/fade.
const geometryRandom=Math.random;
Math.random=()=>.5;
addEffect({position:{x:10,y:20},rotation:0,effect:[{type:'polygon',color:'#fff',radius:10,radiusEven:[0,8],pointCount:4,duration:200,dissolveDuration:100,fadeDuration:50}]});
Math.random=()=>{throw new Error('Rendering must not reroll polygon geometry');};
const basePoints=effects[0].parts[0].points.map(point=>[...point]);
frame=record();
assert(frame.fills[0].path.points.every((point,index)=>Math.abs(Math.hypot(...point)-(index%2?.9:0))<1e-10),'an animated radius can start at zero');
updateEffects(100);frame=record();
assert(frame.fills[0].path.points.every((point,index)=>Math.abs(Math.hypot(...point)-(index%2?.9:.36))<1e-10),'only the alternate corners move as the shape softens');
updateEffects(75);frame=record();
assert(frame.clips[0].points.every((point,index)=>Math.abs(Math.hypot(...point)-(index%2?.9:.63))<1e-10),'dissolve clips against the current morphed outline');
assert.equal(frame.fills[0].alpha,.5,'a morphing shell can fade while it dissolves');
assert.deepEqual(effects[0].parts[0].points,basePoints,'morphing never mutates the shared base geometry');
updateEffects(25);assert.equal(effects.length,0);
Math.random=geometryRandom;

// Fan polygons share the normal animation but stay forward of their origin.
const fanSpread=Math.PI/3;
addEffect({position:{x:10,y:20},rotation:Math.PI/2,effect:[
  {type:'polygon',color:'#fff',radius:10,pointCount:3,radiusEven:[2,6],duration:100,spread:fanSpread,scale:[.5,1],fadeDuration:100},
  {type:'polygon',color:'#fff',radius:10,pointCount:3,radiusEven:2,duration:100},
]});
const fan=effects[0].parts[0], circle=effects[0].parts[1];
assert.notEqual(fan.path,circle.path,'fans do not reuse circular geometry with the same tip count');
assert.equal(fan.path.points.length,8,'fan geometry includes both inward edge corners and closes back to its origin');
assert.deepEqual(fan.path.points.at(-1),[0,0]);
assert(fan.path.points.every(([x,y])=>x>=0 && Math.abs(y)<=x*Math.tan(fanSpread/2)+1e-10),'all fan tips stay within the forward spread');
const fanPoints=fan.points.map(point=>[...point]);
frame=record(Math.PI/2);
assert.equal(frame.fills[0].size,5,'a fan uses the existing radius and scale animation');
updateEffects(50);frame=record(Math.PI/2);
assert.equal(frame.fills[0].size,7.5);
assert.equal(frame.fills[0].alpha,.5,'fans use the normal fade timing');
assert(frame.fills[0].path.points.every(([x,y])=>x>=0 && Math.abs(y)<=x*Math.tan(fanSpread/2)+1e-10),'animated inward corners preserve the forward spread');
assert.deepEqual(fan.points,fanPoints,'fan animation keeps its original geometry');
updateEffects(50);assert.equal(effects.length,0);

// Numeric easing controls deceleration without changing the scale endpoints.
addEffect({position:{x:10,y:20},rotation:0,effect:[{type:'ring',color:'#fff',radius:40,duration:250,scale:[0,1],easeOut:2.5}]});
updateEffects(125);frame=record();
assert(Math.abs(frame.strokes[0].radius-40*(1-.5**2.5))<1e-10);
updateEffects(125);assert.equal(effects.length,0);

// Gameplay emits presentation events; an explosion replaces only its source's sparks.
const world=createWorld(), source=addEntity(world,new GameObject({id:1,health:100,position:{x:10,y:20}}));
const events=[];
explode({object:source,radius:1,impulse:0,effect:spec,events});
assert.equal(events.length,1);assert.equal(events[0].type,'explosion');
assert.equal(effects.length,0);
const collision={type:'collision',a:source.id,b:2,damage:[2,2],impact:0,colors:['#44f','#44f'],position:{x:10,y:20}};
const destruction={type:'objectDestroyed',objectId:source.id,damage:2,color:'#44f',position:{x:10,y:20}};
presentEvents({events:[collision,destruction,...events]});
assert.equal(effects.length,1);
assert.equal(sparks.length,4,'only source sparks are suppressed, even when the target has the same colour');
assert.equal(source.health,100,'presentation does not modify gameplay');
sparks.length=0;
presentEvents({events:[{...collision,a:2,b:source.id},...events]});
assert.equal(sparks.length,4,'source suppression works on either side of a collision');
sparks.length=0;
presentEvents({events:[collision,destruction]});
assert.equal(sparks.length,12,'ordinary collision and destruction sparks remain without a dedicated effect');
updateEffects(350);assert.equal(effects.length,0);

// Spark lifetime uses milliseconds; speed remains in units per second.
sparks.length=0;
const random=Math.random;
Math.random=()=>.5;
sprayDamage({position:{x:0,y:0},color:'#f00',damage:1});
Math.random=random;
updateSparks(100);
assert(sparks.every(spark=>spark.health===200 && spark.position.x===-7.5));
updateSparks(199);assert.equal(sparks.length,2);
updateSparks(1);assert.equal(sparks.length,0);
console.log('Generic effect geometry, animation, placement, lifetime and presentation passed');
`;

const entryId = `${root}/src/__explosion_effects_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'explosion-effects-test',
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
            return 'export const playSound=()=>{};export const updateThrusterSound=()=>{};';
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
