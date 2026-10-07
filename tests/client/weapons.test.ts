/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { initKeys, playerInput } from '${root}/src/client/input/input.ts';
import { moduleBinding } from '${root}/src/client/input/keybindings.ts';
import { createPlayerShip } from '${root}/src/client/objects/create-ship.ts';
import { createWorld, addEntity, addPlayer } from '${root}/src/client/simulation/world.ts';
import { PredictionManager } from '${root}/src/client/prediction/prediction.ts';
import { updateWorld } from '${root}/src/client/simulation/update-world.ts';
import { cloneEntity, captureWorld, restoreWorld } from '${root}/src/client/simulation/world-state.ts';
import { controlShip } from '${root}/src/client/objects/control-ship.ts';
import { Autocannon, PlasmaAccelerator, moduleTypes } from '${root}/src/client/objects/modules/index.ts';
import { Craft } from '${root}/src/client/objects/craft.ts';
import { contactBetween } from '${root}/src/client/collision/contact-between.ts';
import { GameObject } from '${root}/src/client/objects/game-object.ts';
import { Projectile } from '${root}/src/client/objects/projectile.ts';
import { explode } from '${root}/src/client/objects/explosion.ts';
import { updateEntities } from '${root}/src/client/simulation/update-tier.ts';
import { damage } from '${root}/src/client/objects/damage.ts';
import { Asteroid } from '${root}/src/client/objects/asteroid.ts';
import { Item } from '${root}/src/client/objects/item.ts';
import { autocannonAmmunition, gold } from '${root}/src/specs/items/index.ts';
import { moduleSpecs } from '${root}/src/specs/modules/index.ts';
import { game } from '${root}/src/client/game.ts';
import { colors } from '${root}/src/specs/colors.ts';
import { presentEvents } from '${root}/src/client/effects/present-events.ts';
import { effects } from '${root}/src/client/effects/effect.ts';
import { sparks } from '${root}/src/client/effects/shrapnel.ts';
import { renderingLayers } from '${root}/src/specs/rendering-layers.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';
globalThis.Path2D=class {moveTo(){} lineTo(){} closePath(){}};
globalThis.window=new EventTarget();
initKeys();
// Recoil is an impulse per successful shot, opposite the ship's facing.
for(const weapon of [PlasmaAccelerator,Autocannon]) for(const rotation of [0,Math.PI/2,Math.PI]) for(const moving of [false,true]){
  const recoilWorld=createWorld();
  const recoilShip=addEntity(recoilWorld,createPlayerShip(recoilWorld,{playerId:1,rotation,velocity:moving?Vec.create(7,-3):Vec.create()}));
  recoilWorld.players.set(1,{id:1,shipId:recoilShip.id});
  const gun=new weapon();
  recoilShip.fit(gun,recoilShip.mounts.find(mount=>mount.fits.includes(weapon)));
  recoilShip.cargoContents.push(new Item(autocannonAmmunition));
  recoilShip.setModuleActive({module:weapon,active:true});
  const startingVelocity=Vec.clone(recoilShip.velocity), start=Vec.clone(recoilShip.position);
  recoilShip.fireWeapons(0);
  const shot=[...recoilWorld.entities.values()].find(entity=>entity instanceof Projectile);
  assert(shot,'a successful shot is required for recoil');
  const impulse=Vec.subtract(recoilShip.velocity,startingVelocity);
  const amount=(gun.recoil ?? 0)/recoilShip.mass;
  assert(Math.abs(impulse.x+Math.cos(rotation)*amount)<1e-9 && Math.abs(impulse.y+Math.sin(rotation)*amount)<1e-9,'recoil applies the configured mass-scaled impulse, rotated with the ship');
  assert.equal(recoilShip.spin,0,'recoil does not turn the ship');
  assert(Math.abs(Vec.distance(shot.velocity,startingVelocity)-gun.projectile.speed)<1e-9,'the projectile inherits velocity before recoil');
  const after=Vec.clone(recoilShip.velocity);
  recoilShip.fireWeapons(.01);
  assert.deepEqual(recoilShip.velocity,after,'cooldown does not repeatedly apply recoil');
  recoilShip.update(1/30);
  if(!moving && weapon===PlasmaAccelerator){
    assert(Vec.distance(start,recoilShip.position)>0,'a stationary ship really moves on the next update');
    assert(Vec.dot(Vec.subtract(recoilShip.position,start),impulse)>0,'the displacement follows the recoil');
  }
}
const world=createWorld();
const ship=addEntity(world,createPlayerShip(world,{playerId:1}));
world.players.set(1,{id:1,shipId:ship.id});
const plasma=new PlasmaAccelerator(), auto=new Autocannon();
ship.fit(plasma,ship.mounts.find(mount=>mount.fits.includes(PlasmaAccelerator)));
ship.fit(auto,ship.mounts.find(mount=>mount.fits.includes(Autocannon) && mount.module!==plasma));
const keyEvent=(type)=>window.dispatchEvent(Object.assign(new Event(type),{key:' ',repeat:false}));
keyEvent('keydown');
controlShip(ship,playerInput,[]);
assert(ship.moduleActive({module:PlasmaAccelerator}) && ship.moduleActive({module:Autocannon}),'Space enables both fitted weapons');
ship.setModuleActive({module:Autocannon,active:false});
controlShip(ship,playerInput,[]);
assert(ship.moduleActive({module:PlasmaAccelerator}) && ship.moduleActive({module:Autocannon}),'holding Space synchronizes weapons with different activation states');
assert.equal(moduleBinding('fire').mode,'hold','weapons use the existing hold binding');
const ammo=new Item(autocannonAmmunition);
assert.equal(ammo.rounds,200,'a new ammunition pack contains 200 rounds');
ship.cargoContents.push(new Item(gold),ammo);
ship.fireWeapons(0);
for(let tick=1;tick<120;tick++)ship.fireWeapons(1/120);
const shots=[...world.entities.values()].filter(entity=>entity instanceof Projectile);
assert.equal(shots.filter(shot=>shot.definitionId==='plasmaAccelerator').length,1);
assert.equal(shots.filter(shot=>shot.definitionId==='autocannon').length,4,'autocannon fires four shots per second');
for(const shot of shots){
  const spec=moduleSpecs[shot.definitionId].projectile;
  assert.equal(shot.radius,spec.radius,'collision radius comes from the nested projectile settings');
  assert.equal(shot.health,moduleSpecs[shot.definitionId].damage,'projectile health starts at its weapon damage');
  const inherited=shot.definitionId==='plasmaAccelerator'?Vec.create():ship.velocity;
  assert(Math.abs(Vec.distance(shot.velocity,inherited)-spec.speed)<1e-6,'firing uses the nested projectile speed');
}
assert.equal(ammo.rounds,196,'one round consumed per shot');
assert(ship.cargoContents.includes(ammo),'partially used packs remain in cargo');
assert(ship.cargoContents.some(item=>item.resource===gold.resource),'ore is not ammunition');
assert(moduleSpecs.plasmaAccelerator.projectile.speed<moduleSpecs.autocannon.projectile.speed);
const checkpoint=captureWorld({world});
const cooldown=plasma.fireCooldown;
ship.fireWeapons(.25);
assert.equal(ammo.rounds,195);
restoreWorld({world,state:checkpoint});
assert.equal(ammo.rounds,196,'rollback restores ammunition remaining in cargo');
assert.equal(plasma.fireCooldown,cooldown,'rollback restores firing cadence');
const state=ship.moduleStates.find(state=>state.type===moduleTypes.indexOf(PlasmaAccelerator));
assert.equal(state.fireCooldown,cooldown,'replication carries weapon cooldown');
for(let shot=0;shot<196;shot++)ship.fireWeapons(.25);
assert(!ship.cargoContents.includes(ammo),'a pack is removed after its 200th shot');
assert.equal([...world.entities.values()].filter(shot=>shot.definitionId==='autocannon').length,200);
ship.fireWeapons(.25);
assert.equal([...world.entities.values()].filter(shot=>shot.definitionId==='autocannon').length,200,'empty autocannon cannot fire');
const lastRound=new Item(autocannonAmmunition,{rounds:1}), nextPack=new Item(autocannonAmmunition);
ship.cargoContents.push(lastRound,nextPack);
ship.fireWeapons(0);
ship.fireWeapons(.25);
assert(!ship.cargoContents.includes(lastRound) && nextPack.rounds===199,'firing continues into the next pack');
ship.cargoContents=ship.cargoContents.filter(item=>item.resource!==5);
keyEvent('keyup');
controlShip(ship,playerInput,[]);
assert(!ship.moduleActive({module:PlasmaAccelerator}) && !ship.moduleActive({module:Autocannon}),'releasing Space stops both');
keyEvent('keydown');
controlShip(ship,playerInput,[]);
window.dispatchEvent(new Event('blur'));
controlShip(ship,playerInput,[]);
assert(!ship.moduleActive({module:PlasmaAccelerator}) && !ship.moduleActive({module:Autocannon}),'losing focus releases held weapons');
const before=world.entities.size;
ship.fireWeapons(1);
assert.equal(world.entities.size,before,'released guns do not fire');
controlShip(ship,{...playerInput,fire:true},[]);
ship.dockedTo=100;
ship.fireWeapons(1);
assert.equal(world.entities.size,before,'docked guns do not fire');
ship.dockedTo=0;
ship.launching=1;
ship.fireWeapons(1);
assert.equal(world.entities.size,before,'launching guns do not fire');

for(const id of ['plasmaAccelerator','autocannon']){
  for(const maxHealth of [31,71]) for(const previousDamage of [0,10.5]){
    const targetWorld=createWorld();
    const outline=[[-10,-10],[10,-10],[10,10],[-10,10]];
    const asteroid=addEntity(targetWorld,new Asteroid({world:targetWorld,id:200,position:Vec.create(),radius:15,mass:10,health:100,maxHealth:100,contents:[],resource:maxHealth===71?1:0,shapeOutline:outline,segments:[{contents:[],health:maxHealth,maxHealth,mass:10,shapeOutline:outline}]}));
    damage(asteroid.segments[0],previousDamage);
    const amount=moduleSpecs[id].damage;
    const count=Math.floor((asteroid.segments[0].health-1)/amount)+1;
    const events=[];
    for(let n=1;n<=count;n++){
      Vec.set(asteroid.velocity,Vec.create());
      asteroid.spin=0;
      const projectile=addEntity(targetWorld,new Projectile(id,{world:targetWorld,id:300+n,playerId:1,position:Vec.create(-80,0),velocity:Vec.create(600,0)}));
      projectile.captureSweep();
      projectile.update(.3);
      sparks.length=effects.length=0;
      const beforeEvents=events.length;
      projectile.resolveHits(events,targetWorld,.3);
      const hit=events.slice(beforeEvents).find(event=>event.type==='collision');
      assert(hit,'a projectile hit emits the same collision event as physical impacts');
      assert.equal(hit.a,projectile.id);
      assert.equal(hit.b,asteroid.id);
      assert.equal(hit.damage[0],amount,'the projectile takes its own weapon damage');
      assert(projectile.health<=0,'self damage exhausts the projectile health');
      assert.equal(hit.colors[0],moduleSpecs[id].projectile.color,'projectile sparks use their own configured colour');
      assert.equal(hit.damage[1],amount,'each hit applies the same weapon damage regardless of segment strength or earlier damage');
      assert(hit.position.x>-15 && hit.position.x<-9 && Math.abs(hit.position.y)<1e-6,'the contact is on the swept path at the near face, not the projectile endpoint');
      assert.equal(hit.colors[1],colors[maxHealth===71?'violet':'white'][2],'rock sparks use the struck asteroid outline colour');
      assert.equal(sparks.length,0,'hit resolution keeps presentation out of simulation');
      assert.equal(effects.length,0,'simulation does not create visual effects');
      presentEvents({events:events.slice(beforeEvents)});
      assert.equal(effects.length,id==='plasmaAccelerator'?1:0,'only configured projectiles present an explosion');
      assert.equal(sparks.length,id==='plasmaAccelerator'?4:8,'dedicated effects replace projectile sparks while preserving target sparks');
      if(id==='autocannon') assert(sparks.slice(0,4).every(spark=>spark.color===hit.colors[0]),'ordinary projectile damage emits its own colour of sparks');
      assert(sparks.slice(id==='plasmaAccelerator'?0:4).every(spark=>spark.color===hit.colors[1]),'target damage emits the struck surface colour');
      assert(sparks.every(spark=>Vec.distance(spark.position,hit.position)<1e-8),'both bursts use the impact position');
      assert(projectile.dead,'a fast projectile hits the polygon instead of tunnelling through');
      assert.equal(events.some(event=>event.type==='asteroidSplit'),n===count,'a chunk splits only when accumulated damage takes its health below one');
    }
  }
}
const remote=addEntity(world,createPlayerShip(world,{playerId:2}));
const remoteGun=new PlasmaAccelerator();
remote.fit(remoteGun,remote.mounts.find(mount=>mount.fits.includes(PlasmaAccelerator)));
controlShip(remote,{...playerInput,fire:true},[]);
const beforeRemote=world.entities.size;
remote.fireWeapons(1);
assert.equal(world.entities.size,beforeRemote,'remote ships use replicated shots instead of creating duplicates');
const circleWorld=createWorld();
const friendly=addEntity(circleWorld,new GameObject({id:1,playerId:1,health:100,radius:5,position:Vec.create(-10,0)}));
const far=addEntity(circleWorld,new GameObject({id:2,playerId:2,health:100,radius:5,position:Vec.create(40,0)}));
const near=addEntity(circleWorld,new GameObject({id:3,playerId:2,health:100,radius:5,position:Vec.create(20,0)}));
const circleShot=addEntity(circleWorld,new Projectile('autocannon',{id:4,playerId:1,position:Vec.create(-80,0),velocity:Vec.create(600,0)}));
circleShot.update(.3);
const circleEvents=[];
circleShot.resolveHits(circleEvents,circleWorld,1/30);
assert.equal(circleEvents[0].damage[1],4,'circle hits also report damage through collision events');
assert(circleShot.dead);
assert.equal(friendly.health,100,'projectiles ignore the firing player');
assert.equal(near.health,96,'the closest circle receives damage across a catch-up sweep');
assert.equal(far.health,100,'a shot cannot damage two targets');
const hydration=new Projectile('autocannon',{health:1.25});
assert(hydration instanceof Projectile);
assert.equal(hydration.health,1.25,'remaining projectile health survives hydration');
assert.equal(hydration.radius,2,'autocannon rounds use the larger collision and render radius');
hydration.update(2);
assert(hydration.dead,'projectiles expire');

{
  const blastWorld=createWorld();
  const source=addEntity(blastWorld,new GameObject({id:1}));
  const neighbour=addEntity(blastWorld,new GameObject({id:2,position:Vec.create(10,0),mass:1,health:100}));
  explode({object:source,radius:20,impulse:8});
  assert.equal(neighbour.velocity.x,4,'ordinary game objects can use the shared explosion');
  assert.equal(neighbour.health,100,'the shared impulse does not add splash damage');
  assert.equal(Vec.length(source.velocity),0,'the source does not push itself');
  assert(!source.dead,'the shared explosion does not own the source lifecycle');
  const spin=neighbour.spin;
  assert(spin!==0 && Math.abs(spin)<=3,'blast gives nearby objects a bounded spin');
  assert.equal(neighbour.rotation,0,'blast changes spin without snapping the angle');
  assert.equal(source.spin,0);
  neighbour.spin=.7;
  explode({object:source,radius:20,impulse:8});
  assert(Math.abs(neighbour.spin-.7-spin)<1e-12,'blast spin is seeded and additive');
  neighbour.spin=0;neighbour.position.x=15;
  explode({object:source,radius:20,impulse:8});
  assert.equal(neighbour.spin,spin/2,'spin fades with distance');
  for(const maxSpeed of [0.1,24]){
    const spins=[3,30,300].map(mass=>{
      neighbour.mass=mass;neighbour.radius=8;neighbour.spin=0;
      explode({object:source,radius:20,impulse:2400,maxSpeed});
      return neighbour.spin;
    });
    assert(Math.abs(spins[0])>0.65 && Math.abs(spins[0])<=1.3,'light items get a stronger spin than the old one-radian cap at this falloff');
    assert(Math.abs(spins[1]*10-spins[0])<1e-12,'ten times the mass receives one tenth the spin');
    assert(Math.abs(spins[2]*100-spins[0])<1e-12,'heavy chunks receive much less spin even when linear speed is capped');
  }
  for(const properties of [{position:Vec.create(30,0)},{buried:true},{dead:true}]){
    const excluded=addEntity(blastWorld,new GameObject({id:3,...properties}));
    explode({object:source,radius:20,impulse:8});
    assert.equal(excluded.spin,0,'distant, buried and dead objects do not spin');
  }
}

// Gameplay expiry uses a dedicated effect when configured, otherwise own-colour sparks.
for(const id of ['autocannon','plasmaAccelerator']){
  const expiryWorld=createWorld();
  const shot=addEntity(expiryWorld,new Projectile(id,{id:1,health:.001,position:Vec.create(5,6)}));
  const neighbour=addEntity(expiryWorld,new GameObject({id:2,position:Vec.create(10,6),mass:1}));
  const events=[];
  updateEntities({world:expiryWorld,events,tick:7});
  assert(shot.dead);
  const deathEvents=events.filter(event=>event.type==='objectDestroyed');
  assert.equal(deathEvents.length,1,'timed-out projectiles emit one gameplay death event');
  assert.equal(deathEvents[0].objectId,shot.id);
  assert.equal(events.filter(event=>event.type==='explosion').length,id==='plasmaAccelerator'?1:0);
  sparks.length=effects.length=0;
  presentEvents({events});
  assert.equal(effects.length,id==='plasmaAccelerator'?1:0,'expiry also presents configured effects');
  assert.equal(sparks.length,id==='plasmaAccelerator'?0:4,'expiry replaces source sparks only when a dedicated effect exists');
  assert(sparks.every(spark=>spark.color===moduleSpecs[id].projectile.color && spark.position.x===5 && spark.position.y===6),'expiry sparks retain the projectile colour and location');
  if(id==='autocannon') assert.equal(Vec.length(neighbour.velocity),0,'autocannon expiry emits sparks without applying a blast');
  else assert(neighbour.velocity.x>0,'plasma expiry retains its blast');
  events.length=0;
  updateEntities({world:expiryWorld,events,tick:8});
  assert.equal(events.length,0,'removed projectiles do not repeat their death event');
}

// Only specs opting into effects scan and push nearby objects.
for(const id of ['plasmaAccelerator','autocannon']) for(const trigger of ['hit','expiry','cleanup']){
  const blastWorld=createWorld();
  const target=addEntity(blastWorld,new GameObject({id:1,position:Vec.create(20,0),radius:5,health:100}));
  const light=addEntity(blastWorld,new GameObject({id:2,position:Vec.create(13,10),radius:1,mass:1,health:100}));
  const heavy=addEntity(blastWorld,new GameObject({id:3,position:Vec.create(13,10),radius:1,mass:1000,health:100}));
  const below=addEntity(blastWorld,new GameObject({id:4,position:Vec.create(13,-10),radius:1,mass:1,health:100}));
  const far=addEntity(blastWorld,new GameObject({id:5,position:Vec.create(13,50),radius:1,mass:1,health:100}));
  const buried=addEntity(blastWorld,new GameObject({id:6,position:Vec.create(13,-8),radius:1,mass:1,health:100,buried:true}));
  const otherShot=addEntity(blastWorld,new Projectile(id,{id:7,position:Vec.create(13,12)}));
  const shot=addEntity(blastWorld,new Projectile(id,{id:8,position:Vec.create(trigger==='hit'?-80:13,0),velocity:Vec.create(trigger==='hit'?600:0,0)}));
  const spec=moduleSpecs[id];
  assert.equal(shot.health,spec.damage);
  const blastEvents=[];
  if(trigger==='hit'){
    shot.update(.3);
    shot.resolveHits(blastEvents,blastWorld,.3);
    assert.equal(target.health,100-spec.damage);
  } else if(trigger==='expiry'){
    shot.update(spec.projectile.lifetime-.001);
    assert(!shot.dead,'projectiles retain their configured lifespan');
    updateEntities({world:blastWorld,entities:[shot],events:blastEvents,dt:.002,tick:7});
    assert.equal(target.health,100-(spec.projectile.explosion?.damage||0),'only plasma expiry damages nearby objects');
  } else shot.remove();
  assert(shot.dead && !blastWorld.entities.has(shot.id),'death removes the projectile from the world');
  if(trigger==='cleanup' || !spec.projectile.explosion){
    assert.equal(Vec.length(light.velocity),0,'simple projectiles and replication cleanup do not trigger an explosion');
    assert.equal(Vec.length(below.velocity),0,'simple projectiles do not push nearby objects');
    assert.equal(Vec.length(otherShot.velocity),0,'simple projectiles do not push other projectiles');
    assert.equal(light.health,100,'autocannon and cleanup do not deal splash damage');
    continue;
  }
  assert(light.velocity.y>0 && below.velocity.y<0,'unhit objects are pushed radially away from the projectile');
  assert(light.velocity.y>heavy.velocity.y && heavy.velocity.y>0,'massive fragments receive a smaller push, while lighter objects respect the configured speed cap');
  assert(Vec.length(light.velocity)<=spec.projectile.explosion.maxSpeed,'the blast caps the added speed for light objects');
  assert(otherShot.velocity.y>0,'nearby projectiles can also be pushed');
  assert.equal(light.health,100-spec.projectile.explosion.damage,'plasma damages nearby objects it did not hit');
  assert.equal(heavy.health,light.health,'damage is independent of mass');
  assert.equal(below.health,light.health);
  assert(blastEvents.some(event=>event.type==='collision' && event.b===light.id && event.damage[1]>0),'splash damage emits target-colour sparks');
  assert.equal(far.health,100);
  assert.equal(buried.health,100);
  assert.equal(Vec.length(far.velocity),0,'objects outside the blast remain still');
  assert.equal(Vec.length(buried.velocity),0,'buried contents stay inside their asteroid');
  const velocity=Vec.clone(light.velocity);
  shot.resolveHits(blastEvents,blastWorld,.3);
  shot.update(.1);
  assert.deepEqual(light.velocity,velocity,'an expired projectile does not explode again');
}
{
  const blastWorld=createWorld();
  const outline=[[-10,-10],[10,-10],[10,10],[-10,10]];
  const asteroid=addEntity(blastWorld,new Asteroid({id:1,contents:[2],health:5,maxHealth:5,radius:15,mass:10,position:Vec.create(),shapeOutline:outline}));
  const shot=addEntity(blastWorld,new Projectile('plasmaAccelerator',{id:2,position:Vec.create(-80,0),velocity:Vec.create(600,0)}));
  shot.update(.3);
  shot.resolveHits([],blastWorld,.3);
  const released=[...blastWorld.entities.values()].find(entity=>entity instanceof Item);
  assert(asteroid.dead && released,'destroying the asteroid releases its resource');
  assert(released.velocity.x>0,'resources created by the hit are pushed by the same explosion');
}

// Real item and asteroid masses must retain the kick after movement updates.
for(const id of ['plasmaAccelerator','autocannon']){
  const blastWorld=createWorld();
  const item=addEntity(blastWorld,new Item(gold,{id:1,position:Vec.create(15,18)}));
  const rocks=[62.5,300].map((mass,index)=>addEntity(blastWorld,new Asteroid({id:index+2,contents:[],health:100,maxHealth:100,radius:10,mass,position:Vec.create(15,index?-15:15),shapeOutline:[[-8,-8],[8,-8],[8,8],[-8,8]]})));
  const targets=[item,...rocks];
  const starts=targets.map(target=>Vec.clone(target.position));
  const shot=addEntity(blastWorld,new Projectile(id,{id:4,health:.001,position:Vec.create()}));
  updateEntities({world:blastWorld,entities:[shot],tick:7,events:[]});
  assert(shot.dead);
  for(const target of targets){
    assert(Vec.length(target.velocity)<=(moduleSpecs[id].projectile.explosion?.maxSpeed||0),'a blast respects its speed cap');
    for(let tick=0;tick<30;tick++) target.update(1/30);
  }
  targets.forEach((target,index)=>{
    const distance=Vec.distance(target.position,starts[index]);
    if(id==='plasmaAccelerator'){
      assert(distance>1,'items and small asteroid chunks keep moving after a plasma blast');
      assert(Vec.dot(Vec.subtract(target.position,starts[index]),starts[index])>0,'movement is away from the explosion');
    } else assert.equal(distance,0,'autocannon expiry leaves nearby items and chunks stationary');
  });
}

// Area damage follows actual polygons, and all broken pieces detach together.
{
  const blastWorld=createWorld();
  const source=addEntity(blastWorld,new GameObject({id:1,velocity:Vec.create(1,0)}));
  const segments=[-10,10,50].map(x=>({contents:[],health:5,maxHealth:20,mass:10,shapeOutline:[[x,-10],[x+20,-10],[x+20,10],[x,10]]}));
  const rock=addEntity(blastWorld,new Asteroid({id:2,contents:[],health:100,maxHealth:100,radius:80,mass:30,position:Vec.create(),segments}));
  const events=[];
  explode({object:source,radius:24,impulse:12,damage:10,events});
  assert(rock.dead,'the blast splits the damaged asteroid');
  assert.deepEqual(rock.segments.map(segment=>segment.health),[-5,-5,5],'only segments whose polygons intersect the blast take damage');
  const children=[...blastWorld.entities.values()].filter(entity=>entity instanceof Asteroid);
  assert.equal(children.length,3,'both broken segments detach in one fracture');
  assert(children.every(child=>child.health>0 && !child.segments?.some(segment=>segment.health<1)),'new chunks receive no second damage or unresolved broken segments');
  assert.equal(events.filter(event=>event.type==='asteroidSplit').length,1);
  assert.equal(events.filter(event=>event.type==='collision').length,2);
  assert(children.filter(child=>child.position.x<30).every(child=>Vec.length(child.velocity)>0),'new nearby chunks receive the radial push');
}
{
  const blastWorld=createWorld();
  const source=addEntity(blastWorld,new GameObject({id:1,position:Vec.create(30,20)}));
  const craft=addEntity(blastWorld,new Craft({world:blastWorld,id:2,radius:100,hullSegments:[{health:100,points:[[-2,-2],[2,-2],[2,2],[-2,2]],mounts:[[{x:20,y:20,fits:['plasmaAccelerator']}]]}]}));
  const gun=new PlasmaAccelerator();
  craft.fit(gun);
  const events=[];
  explode({object:source,radius:24,impulse:0,damage:3,events});
  assert.equal(gun.mount.health,gun.health-3,'overlapping model parts share one damage application to the module mount');
  assert.equal(craft.segments.find(segment=>segment.hull).health,100,'a nearby bounding circle does not make a distant hull take splash damage');
  assert.equal(events.filter(event=>event.type==='collision').length,1);
  const shot=addEntity(blastWorld,new Projectile('plasmaAccelerator',{id:3,position:Vec.create(80,19),velocity:Vec.create(-600,0)}));
  const health=gun.mount.health;
  shot.update(.1);
  shot.resolveHits(events,blastWorld,.1);
  assert(shot.dead);
  assert.equal(gun.mount.health,health-moduleSpecs.plasmaAccelerator.damage,'the direct plasma hit excludes the whole fitted module from repeated splash damage');
}

const fills=[];
const halos=[];
let gradients=0;
game.ctx={save(){},restore(){},translate(){},rotate(){},beginPath(){},arc(){},stroke(){},fill(){fills.push(this.fillStyle);},createRadialGradient(...coordinates){gradients++;const gradient={stops:[],addColorStop(offset,color){this.stops.push([offset,color]);}};halos.push({coordinates,gradient});return gradient;}};
game.scale=1;
const rechargeWorld=createWorld();
const chargingShip=addEntity(rechargeWorld,createPlayerShip(rechargeWorld,{playerId:3}));
rechargeWorld.players.set(3,{id:3,shipId:chargingShip.id});
const chargingGun=new PlasmaAccelerator({shades:colors.cyan});
chargingShip.fit(chargingGun,chargingShip.mounts.find(mount=>mount.fits.includes(PlasmaAccelerator)));
const indicators=chargingShip.segments.filter(segment=>segment.module===chargingGun && segment.rechargeDelay!==undefined);
assert.equal(indicators.length,3);
const backing=chargingShip.segments.find(segment=>segment.module===chargingGun && segment.color===0);
chargingGun.render({segment:backing,craft:chargingShip});
assert.equal(fills.at(-1),colors.cyan[0],'the backing uses the darkest module palette shade');
assert.equal(chargingShip.segmentsAtMount(chargingGun.mount)[0],backing,'the dark rectangle draws behind the barrel and indicators');

const glowCount=()=>{
  const previous=gradients;
  chargingShip.render({zIndex:renderingLayers.glowBelowShips});
  return gradients-previous;
};
assert.equal(glowCount(),3,'ready indicators glow without holding fire');
assert(halos.slice(-3).every((halo,index)=>halo.coordinates[5]===indicators[index].glow.radius),'each indicator halo uses its configured glow radius');
assert(halos.slice(-3).every(halo=>halo.gradient.stops[0][1]===colors.cyan[2]),'indicator halos follow the module paint');
assert(halos.slice(-3).every(halo=>halo.gradient.stops.at(-1)[1]==='#00000000'),'the configured indicator glow keeps its original transparent edge');

const indicatorColors=()=>{
  indicators.forEach(segment=>chargingGun.render({segment,craft:chargingShip}));
  return fills.slice(-3);
};
const plasmaShots=()=>[...rechargeWorld.entities.values()].filter(entity=>entity instanceof Projectile).length;
assert.deepEqual(indicatorColors(),[colors.cyan[2],colors.cyan[2],colors.cyan[2]],'a ready weapon has three bright indicators in its paint colour');
controlShip(chargingShip,{...playerInput,fire:true},[]);
chargingShip.fireWeapons(0);
assert.deepEqual(indicatorColors(),[colors.cyan[0],colors.cyan[0],colors.cyan[0]],'firing darkens all three indicators');
assert.equal(glowCount(),0,'discharged indicators have no glow');
for(let index=0;index<3;index++){
  chargingShip.fireWeapons(.499);
  assert.equal(plasmaShots(),1,'cannot fire before the configured recharge completes');
  assert.deepEqual(indicatorColors(),indicators.map((_,i)=>colors.cyan[i<index?2:0]),'indicators stay dark until their recharge boundary');
  if(index===2)controlShip(chargingShip,{...playerInput,fire:false},[]);
  chargingShip.fireWeapons(.001);
  assert.deepEqual(indicatorColors(),indicators.map((_,i)=>colors.cyan[i<=index?2:0]),'one indicator recharges every half second');
  assert.equal(glowCount(),index+1,'each recharge restores only its indicator glow');
}
chargingShip.fireWeapons(chargingGun.fireInterval-1.5);
controlShip(chargingShip,{...playerInput,fire:true},[]);
chargingShip.fireWeapons(0);
assert.equal(plasmaShots(),2,'can fire again when the configured cooldown completes');
assert.deepEqual(indicatorColors(),[colors.cyan[0],colors.cyan[0],colors.cyan[0]],'each shot restarts the recharge sequence');

// The same spec settings work on another weapon, with different colours and glow.
const genericShip=addEntity(rechargeWorld,createPlayerShip(rechargeWorld,{playerId:4}));
const genericGun=new Autocannon({
  shades:colors.green,
  model:[{...Autocannon.model[0],color:1,rechargeDelay:.1,rechargeColor:0,glow:{radius:7,alpha:.4,stops:[[0,1],[1,'#000',0]]}}],
});
genericShip.fit(genericGun,genericShip.mounts.find(mount=>mount.fits.includes(Autocannon)));
const genericPart=genericShip.segmentsAtMount(genericGun.mount)[0];
genericGun.fireCooldown=.25;
genericGun.render({segment:genericPart});
assert.equal(fills.at(-1),colors.green[0],'any weapon uses its configured recharge colour');
const beforeGenericGlow=gradients;
genericGun.renderGlow({segment:genericPart});
assert.equal(gradients,beforeGenericGlow,'any weapon suppresses its configured glow until the part recharges');
genericGun.fireCooldown=.15;
genericGun.render({segment:genericPart});
assert.equal(fills.at(-1),colors.green[1],'any weapon restores its configured charged colour');
genericGun.renderGlow({segment:genericPart});
assert.equal(gradients,beforeGenericGlow+1);
assert.equal(halos.at(-1).coordinates[5],7,'the glow radius comes from the model part');
assert.equal(game.ctx.globalAlpha,.4,'the glow opacity comes from the model part');
assert.deepEqual(halos.at(-1).gradient.stops,[[0,colors.green[1]],[1,'#00000000']],'gradient stops accept paint shades and literal colours from the spec');
genericPart.rechargeDelay=undefined;
genericGun.fireCooldown=.25;
genericGun.renderGlow({segment:genericPart});
assert.equal(gradients,beforeGenericGlow+2,'a glow without a recharge setting stays visible during firing');

for(const y of [-29,29]){
  chargingGun.mount.localPosition.y=y;
  const side=Math.sign(y);
  const barrel=chargingShip.segments.find(segment=>segment.module===chargingGun && segment.rechargeDelay===undefined && segment.color===undefined);
  assert.deepEqual(barrel.points(barrel).slice(3,7),[[12,3*side],[10.5,.5*side],[1,.5*side],[1,3*side]],'the cutout faces away from the ship centre');
  assert(indicators.every(segment=>segment.points(segment).every(([x,localY])=>x>=1 && x<12 && localY*side>.5 && localY*side<=3)),'all recharge rectangles stay inside the cutout');
}
for(const Type of [PlasmaAccelerator,Autocannon])for(const side of [-1,1]){
  const collisionWorld=createWorld();
  const craft=addEntity(collisionWorld,new Craft({world:collisionWorld,id:1,radius:100,hullSegments:[{health:100,points:[[-2,-2],[2,-2],[2,2],[-2,2]],mounts:[[{x:20,y:side*20,fits:[Type.definitionId]}]]}]}));
  const gun=new Type();
  craft.fit(gun);
  const first=craft.segmentsAtMount(gun.mount)[0];
  const firstPoints=typeof first.points==='function'?first.points(first):first.points;
  assert.equal(firstPoints[0][1],moduleSpecs[gun.definitionId].model[0].points[0][1]*side,'ordinary barrel and backing parts mirror along with recharge indicators');
  const colliders=craft.hitbox(true).filter(collider=>collider.segment.module===gun);
  assert(colliders.length>0,'both weapon barrels have physical colliders on either side of the ship');
  assert(colliders.every(collider=>collider.physics && collider.radius>0),'mirrored weapon parts have collision bounds');
  const atBarrel=Vec.add(gun.mount.localPosition,Vec.create(15,-1));
  assert(colliders.some(collider=>contactBetween(collider,{position:atBarrel,radius:1})),'an object touching the exposed barrel collides with its visible geometry');
  const projectile=addEntity(collisionWorld,new Projectile('autocannon',{world:collisionWorld,id:2,playerId:2,position:Vec.add(gun.mount.localPosition,Vec.create(60,-1)),velocity:Vec.create(-600,0)}));
  const health=gun.mount.health;
  projectile.captureSweep();
  projectile.update(.1);
  projectile.resolveHits([],collisionWorld,.1);
  assert(projectile.dead && gun.mount.health<health,'projectiles strike the weapon barrel rather than passing through it');
}
// Synthetic visuals test both projectile types without fixing their production colours.
for(const id of ['plasmaAccelerator','autocannon']){
  const custom=moduleSpecs[id].projectile;
  const original={...custom};
  Object.assign(custom,{radius:3,lifetime:4,color:colors.yellow[2],glow:{color:colors.green[2],alpha:4/15,radius:30}});
  const customShot=new Projectile(id);
  assert.equal(customShot.radius,3);
  assert.equal(customShot.health,moduleSpecs[id].damage);
  const beforeGlow=gradients;
  customShot.render();
  assert.equal(gradients,beforeGlow+1,'either projectile type renders its configured glow');
  assert.equal(fills.at(-1),colors.yellow[2],'the solid circle keeps its own colour');
  assert.deepEqual(fills.at(-2).stops,[[0,'#33ff7744'],[1,'#00000000']],
    'the glow combines its own colour and numeric opacity before fading to transparent');
  assert.equal(halos.at(-1).coordinates[5],30,'glow size is independent of projectile radius');
  delete custom.glow;
  const beforeNoGlow=gradients;
  customShot.render();
  assert.equal(gradients,beforeNoGlow,'omitting glow disables it');
  assert.equal(fills.at(-1),colors.yellow[2],'unglowing projectiles retain their configured colour');
  Object.assign(custom,original);
}
for(const delay of [1,3,8]){
  const server=createWorld();
  const serverShip=addEntity(server,createPlayerShip(server,{id:1,playerId:1}));
  serverShip.fit(new Autocannon(),serverShip.mounts.find(m=>m.fits.includes(Autocannon)));
  serverShip.cargoContents.push(new Item(autocannonAmmunition));
  addPlayer(server,{id:1,shipId:serverShip.id});
  addEntity(server,new Asteroid({id:100,position:Vec.create(150,-25),velocity:Vec.create(),radius:50,mass:1000,health:100,maxHealth:100,contents:[],spin:0}));
  const client=createWorld();
  server.entities.forEach(entity=>addEntity(client,cloneEntity({entity})));
  addPlayer(client,{id:1,shipId:1});
  const prediction=new PredictionManager({world:client});
  prediction.setLocalPlayer({playerId:1});
  const packets=[];
  const emitted=[];
  for(let tick=0;tick<160;tick++){
    const input={...playerInput,fire:tick<130};
    emitted.push(...prediction.step({input,send(){}}));
    updateWorld({world:server,inputs:new Map([[1,input]])});
    packets.push({tick:server.tick,nextEntityId:server.nextEntityId,entities:[...server.entities.values()].map(entity=>cloneEntity({entity}))});
    const packet=packets[tick-delay];
    if(packet)prediction.reconcile(packet);
    assert.equal(client.entities.has(100),server.entities.has(100),'delayed snapshots must not resurrect an asteroid after its predicted split');
    assert.deepEqual([...client.entities.values()].filter(e=>e instanceof Asteroid).map(e=>e.id),[...server.entities.values()].filter(e=>e instanceof Asteroid).map(e=>e.id),'predicted chunks retain their identities across older snapshots');
    prediction.predictFrame({elapsed:1/120});
  }
  assert.equal(emitted.filter(e=>e.type==='asteroidSplit' && e.asteroidId===100).length,1,'a split is presented once, even across delayed reconciliation');
}
// An authoritative shot may reuse the ID of a different predicted shot.
{
  const world=createWorld();
  const ship=addEntity(world,createPlayerShip(world,{id:1,playerId:1}));
  addPlayer(world,{id:1,shipId:ship.id});
  const shot=addEntity(world,new Projectile('autocannon',{world,id:100,playerId:1,position:Vec.create(500,0),velocity:Vec.create(200,0)}));
  const reported=cloneEntity({entity:shot});
  reported.definitionId='plasmaAccelerator';
  reported.playerId=2;
  reported.health=.75;
  const prediction=new PredictionManager({world});
  prediction.setLocalPlayer({playerId:1});
  prediction.step({input:playerInput,send(){}});
  prediction.reconcile({tick:0,entities:[cloneEntity({entity:ship}),reported]});
  assert.equal(shot.definitionId,'plasmaAccelerator','the server corrects a reused projectile ID to its real weapon');
  assert.equal(shot.playerId,2,'the server corrects the owner used to exclude friendly hits');
  assert(Math.abs(shot.health-(.75-moduleSpecs.plasmaAccelerator.damage/moduleSpecs.plasmaAccelerator.projectile.lifetime/30))<1e-8,'remaining projectile health is corrected before replay');
  const saved=captureWorld({world});
  shot.definitionId='autocannon';
  shot.playerId=1;
  restoreWorld({world,state:saved});
  assert.equal(shot.definitionId,'plasmaAccelerator','rollback retains the corrected projectile weapon');
  assert.equal(shot.playerId,2,'rollback retains the corrected projectile owner');
}
const account={credits:4};
const bought=ship.applyDockAction({action:'buyAmmo'},account);
assert(bought && account.credits===2);
assert.equal(ship.cargoContents.at(-1).resource,5);
assert.equal(ship.cargoContents.at(-1).rounds,200,'purchased packs contain 200 rounds');
assert(ship.cargoContents.at(-1).id>0,'purchased cargo must have a positive entity ID');
ship.cargoContents.length=ship.cargoSpace;
assert.equal(ship.applyDockAction({action:'buyAmmo'},account),undefined,'full cargo blocks buying ammo');
console.log('Weapon controls, cadence, ammunition, CCD, chunk damage, replication and rendering passed');`;

const entryId = `${root}/src/__weapons_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'weapons-test',
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
