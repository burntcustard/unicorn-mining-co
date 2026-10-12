/* global process */
import '../support/audio-context.ts';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';
import { rolldown } from 'rolldown';

// Exercise the mechanics and assertions together under production transforms.
// The browser UI suite checks the HTML docking loader across production chunks.
const scenario = `
import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
import { roundMotion } from '${process.cwd()}/src/client/utilities/round.ts';
import assert from 'node:assert/strict';
import { renderingLayers } from '${process.cwd()}/src/specs/rendering-layers.ts';
import { damage } from '${process.cwd()}/src/client/objects/damage.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { PredictionManager } from '${process.cwd()}/src/client/prediction/prediction.ts';
import { cloneEntity } from '${process.cwd()}/src/client/simulation/world-state.ts';
import { createWorld, addEntity } from '${process.cwd()}/src/client/simulation/world.ts';
import { diamond as diamondSpec, itemTypes, message as messageSpec } from '${process.cwd()}/src/specs/items/index.ts';
import { Autogun, CargoHatch, HornDrill, ShieldGenerator, ShieldGeneratorMd, ThrusterDualMd, ThrusterDualXl, ThrusterSingleSm, ThrusterSingleMd, ThrusterTriple, thrusters, moduleTypes } from '${process.cwd()}/src/client/objects/modules/index.ts';
import { Item } from '${process.cwd()}/src/client/objects/item.ts';

import { setCraftActionDispatcher } from '${process.cwd()}/src/client/network/craft-actions.ts';
import { player, adoptPlayerShip, paintUnlocked, readSlate, syncPaintUnlocks, unlockPaint, updatePlayer } from '${process.cwd()}/src/client/player.ts';
import { game } from '${process.cwd()}/src/client/game.ts';
import { presentEvents } from '${process.cwd()}/src/client/effects/present-events.ts';
import { sparks } from '${process.cwd()}/src/client/effects/shrapnel.ts';
import { colors } from '${process.cwd()}/src/specs/colors.ts';
import { mustang } from '${process.cwd()}/src/specs/ships/index.ts';
import { fitsOf, cargoMenuEntriesOf } from '${process.cwd()}/src/client/ui/docked-model.ts';
import { applyCraftAction } from '${process.cwd()}/src/client/network/craft-actions.ts';

assert(colors.gray.join() === '#778,#99a,#bbc,#334,#eef');
assert(colors.black.join() === '#000,#111,#222,#879,#200');
assert(colors.indigo.join() === '#33c,#44d,#55f,#217,#bdf');
assert(colors.purple.join() === '#102,#213,#325,#001,#647');
// Reward lookup must not depend on the palette object's enumeration order.
const redShades = colors.red;
delete colors.red;
colors.red = redShades;
const noteBeforeUnknownReward = player.note;
assert(unlockPaint('UNKNOWN', 'TEST') === undefined);
assert(player.note === noteBeforeUnknownReward);

sparks.length = 0;
presentEvents({ events: [
  { type: 'drillDamage', targetId: 1, by: 1, damage: 1,
    color: '#f0a', position: Vec.create() },
  { type: 'collision', a: 1, b: 2, impact: 80,
    colors: ['#f00', '#0af'], damage: [1, 1], position: Vec.create() },
] });
assert.deepEqual(new Set(sparks.map(({ color }) => color)),
  new Set(['#f0a', '#f00', '#0af']),
  'damage sparks use the contacted outlines');
sparks.length = 0;

// A hull segment destroyed by an impact also breaks off as short-lived,
// physical wreckage instead of disappearing with the surviving hull's split.
const battered = new Ship({shades: colors.white}).addToScene();
const corner = battered.segments.find(({ hull, health }) => hull && health === 8);
corner.health = 0;
battered.update(0);
const hullWreckage = game.crafts.at(-1);
assert(hullWreckage !== battered && hullWreckage.decay && hullWreckage.hitbox().length,
  'destroyed hull remains as physical wreckage');

player.credits = 10000;
// A server-restored negative ID can coincide with the next local allocation.
const purchaseShip = new Ship();
const restoredHatch = new CargoHatch();
restoredHatch.id--;
purchaseShip.fit(restoredHatch, purchaseShip.mounts[0]);
const purchase = purchaseShip.applyDockAction({ action: 'buy', module: moduleTypes.indexOf(Autogun) }, player);
assert(purchase && purchase.moduleId !== restoredHatch.id,
  'buy allocates an ID distinct from restored equipment');
assert.equal(new Set(purchaseShip.modules.map(module => module.id)).size, 2,
  'purchase keeps module identities unique');
assert(purchaseShip.applyDockAction({ action: 'equip', moduleId: purchase.moduleId, mount: 0 }, player),
  'purchased autogun replaces the starter hatch');
assert(purchaseShip.mounts[0].module instanceof Autogun && purchaseShip.cargoContents[0] === restoredHatch,
  'equip addresses the purchased instance and stows the hatch');
assert.equal(purchaseShip.applyDockAction({ action: 'buy', module: moduleTypes.indexOf(Autogun), moduleId: purchase.moduleId }, player), undefined,
  'duplicate purchase IDs are rejected');
const ship = new Ship({ shades: colors.white }).addToScene();
const engineMount=ship.mounts.find(mount=>mount.fits.includes(ThrusterSingleMd));
assert.deepEqual(fitsOf(ship,engineMount),thrusters.filter(type=>engineMount.fits.includes(type)),
  'the dock list preserves thruster display order and only offers compatible types');
// Exercise every thruster independently of the production ships' loadouts.
const thrusterHull=[
  {health:100,core:true,points:[[-16,-20],[8,0],[-16,20]],
    mounts:[[{x:-16,y:0,fits:thrusters.map(type=>type.definitionId)}]]},
  {health:100,core:true,points:[[8,0],[20,0],[-16,20]]}
];
assert.equal(ship.name,'Mustang','ship instances keep their display names under production transforms');
assert.equal(ship.hullMaxHealth, 186, 'Ship hull has twice its original 93 HP');
const sentActions = [];
setCraftActionDispatcher((ship, action) => {
  const applied = ship.applyDockAction(action, player);
  if (applied) sentActions.push(applied);
  return applied;
});
const wreck = new Ship({ shades: colors.white, velocity: Vec.create(12, -7), spin: 0.2 }).addToScene();
const contents = [diamondSpec, messageSpec, messageSpec].map(itemData =>
  new Item(itemData).addToScene());
contents.forEach(item => item.remove());
wreck.cargoContents.push(...contents);
wreck.cockpit.health = 0;
wreck.update(0);
assert(wreck.dead, 'destroyed ship is removed');
for (const item of contents) {
  assert(!item.dead && game.sprites.includes(item), 'cargo and every message are released');
  assert(Math.abs(Vec.length(Vec.subtract(item.velocity, wreck.velocity)) * item.mass - 30) < 1e-9,
    'released contents receive an outward impulse scaled by their mass');
  assert(Math.abs(item.spin) <= 0.5 / item.mass,
    'released contents receive a small random impulse without inheriting ship spin');
}
assert(new Set(contents.map(item => item.spin)).size > 1, 'contents tumble independently');
let second = new CargoHatch();
let first = new CargoHatch();
first.shades = colors.red;
second.shades = colors.orange;
ship.cargoContents.push(first, second);
const mount = ship.mounts[0];
const equip = module => applyCraftAction(ship, {action:'equip',moduleId:module.id,mount:0});
const stableRows = () => assert.deepEqual(fitsOf(ship,mount).slice(0,2).map(module=>module.id),
  [first.id,second.id], 'equip and remove preserve module acquisition order');
stableRows();
equip(second);
assert(mount.module === second, 'equip second instance');
stableRows();
applyCraftAction(ship,{action:'remove',mount:0});
assert(!mount.module && ship.cargoContents.includes(second), 'remove second instance');
stableRows();
equip(first);
assert(mount.module === first, 'equip first instance');
stableRows();
equip(second);
assert(mount.module === second && ship.cargoContents.includes(first), 'swap fitted instances');
stableRows();
// Snapshots replace module objects while preserving acquisition order and paint.
const dockWorld = createWorld();
addEntity(dockWorld,ship);
new PredictionManager({world:dockWorld}).reconcile({tick:0,entities:[cloneEntity({entity:ship})]});
first = ship.modules.find(module=>module.id===first.id);
second = ship.modules.find(module=>module.id===second.id);
stableRows();
assert(first.shades === colors.red && second.shades === colors.orange, 'paint identity');
assert(ship.segments.filter(segment=>segment.mount===mount).every(segment=>segment.shades===colors.orange),
  'equipped paint');
applyCraftAction(ship,{action:'remove',mount:0});
applyCraftAction(ship,{action:'sell',objectIds:[second.id]});
assert(!ship.cargoContents.includes(second) && ship.cargoContents.includes(first), 'sell exact selected instance');
assert.deepEqual(sentActions.at(-1),{action:'sell',objectIds:[second.id]}, 'sale sends exact cargo IDs');
assert(fitsOf(ship,mount)[0]===first, 'remaining owned module replaces sold row');
const lowerMount = ship.mounts[6];
ship.fit(first,lowerMount);
assert(fitsOf(ship,mount)[0]===CargoHatch, 'module fitted elsewhere is not offered');
assert(!ship.cargoContents.length && ship.modules[0]===first, 'fitting preserves ownership');

const beforeBuy = player.credits;
const purchaseAction = applyCraftAction(ship,{action:'buy',module:moduleTypes.indexOf(CargoHatch)});
const bought = ship.modules.find(module=>module.id===purchaseAction.moduleId);
assert(bought.constructor===CargoHatch && bought!==first, 'purchase appends a fresh instance');
assert(player.credits===beforeBuy-CargoHatch.price, 'purchase debits once');
equip(bought);
assert(mount.module===bought && !ship.cargoContents.length, 'new purchase fits');
assert(!paintUnlocked(colors.red) && !paintUnlocked(colors.orange), 'red and orange start locked');
applyCraftAction(ship,{action:'paint',paint:2,moduleId:bought.id,mount:0});
assert(bought.shades===colors.yellow, 'paint purchased module yellow');
applyCraftAction(ship,{action:'paint',paint:5,moduleId:bought.id,mount:0});
assert(bought.shades===colors.violet && first.shades===colors.red, 'painting preserves other modules');

// The ownership checks below need these paints earned before selecting them.
unlockPaint('RED', 'DAMAGED');
assert(player.note === 'DAMAGED - RED UNLOCKED', 'red reward message');
const slatePickup = {type:'itemCollected',itemId:999,resource:4,unlock:'ORANGE',message:'GOLD ORE 100/200'};
const noteBeforeOtherPickup = player.note;
presentEvents({playerId:1,events:[{...slatePickup,by:2}],onMessage:readSlate});
assert(!paintUnlocked(colors.orange) && player.note === noteBeforeOtherPickup,
  'another player reading a slate does not show our message or unlock');
presentEvents({playerId:1,events:[{...slatePickup,by:1}],onMessage:readSlate});
assert(paintUnlocked(colors.red) && paintUnlocked(colors.orange), 'earned paints become available');
assert(player.note === 'CARGO FOUND - ORANGE UNLOCKED', 'orange unlock appears first');
updatePlayer(10);
assert(player.note === 'GOLD ORE 100/200', 'field coordinates follow the unlock');
player.noteFor = 0;
presentEvents({playerId:1,events:[{...slatePickup,by:1,message:'AMETHYST CLUSTER 300/400'}],onMessage:readSlate});
assert(player.note === 'AMETHYST CLUSTER 300/400', 'already unlocked orange shows coordinates only');
applyCraftAction(ship,{action:'paint',paint:0,moduleId:bought.id,mount:0});
assert(bought.shades===colors.red && first.shades===colors.red, 'paint purchased instance');
applyCraftAction(ship,{action:'paint',paint:1,moduleId:bought.id,mount:0});
assert(bought.shades===colors.orange && first.shades===colors.red, 'independent paint');
mount.health=3.11111;
const repairCredits=player.credits;
player.credits=0;
assert.equal(applyCraftAction(ship,{action:'repair',moduleId:bought.id,mount:0}),undefined,
  'unaffordable module repair is rejected');
assert.equal(mount.health,3.11111, 'rejected repair preserves health');
player.credits=repairCredits;
applyCraftAction(ship,{action:'repair',moduleId:bought.id,mount:0});
assert(mount.health===CargoHatch.healthActivated && player.credits===repairCredits-1,
  'module repair charges for displayed missing HP');
assert.deepEqual(sentActions.at(-1),{action:'repair',moduleId:bought.id,mount:0},
  'module repair sends its mounted instance');
applyCraftAction(ship,{action:'remove',mount:0});
assert(!bought.mount && ship.cargoContents[0]===bought, 'removed instance becomes cargo');

const ore={...diamondSpec,name:'Ore',resource:2,price:7};
const gem={...diamondSpec,name:'Diamond',price:11};
for(const [Type,name] of [[ShieldGenerator,'Shield Generator sm'],[ShieldGeneratorMd,'Shield Generator md']]) {
  assert.equal(new Type().name,name, 'shield names preserve their stored case');
}
ship.cargoContents.push(...Array.from({length:11},()=>new Item(ore)));
assert(ship.cargoContents.length>=ship.cargoSpace, 'loose module fills twelfth cargo space');
ship.fit(bought,mount);
assert(ship.cargoContents.length<ship.cargoSpace, 'equipping frees cargo space');
ship.fit(0,mount);
assert(ship.cargoContents.length>=ship.cargoSpace, 'removing consumes cargo space');
const fullCredits=player.credits;
assert.equal(applyCraftAction(ship,{action:'buy',module:moduleTypes.indexOf(CargoHatch)}),undefined,
  'full cargo rejects purchases');
assert(player.credits===fullCredits && ship.modules.length===2, 'rejected buy preserves credits and ownership');
ship.cargoContents=[bought,new Item(ore),new Item(gem),new Item(ore)];
assert.deepEqual(cargoMenuEntriesOf(ship),[[bought,1],[ore,2],[gem,1]],
  'cargo groups resources while keeping individual module instances');
const beforeSale=player.credits;
applyCraftAction(ship,{action:'sell',objectIds:[bought.id]});
assert(ship.modules.length===1 && ship.modules[0]===first, 'cargo sale preserves equipped module');
const oreIds=ship.cargoContents.filter(object=>object.item===ore).map(object=>object.id);
applyCraftAction(ship,{action:'sell',objectIds:oreIds});
assert(ship.cargoContents.length===1 && ship.cargoContents[0].item===gem, 'ore stack sale');
syncPaintUnlocks(100);
assert(!paintUnlocked(colors.cyan), 'cyan is locked before selling a diamond');
applyCraftAction(ship,{action:'sell',objectIds:[ship.cargoContents[0].id]});
assert(!ship.cargoContents.length && player.credits===beforeSale+CargoHatch.price+25, 'last cargo sale');
unlockPaint('CYAN','DIAMOND SOLD');
assert(paintUnlocked(colors.cyan) && player.note==='DIAMOND SOLD - CYAN UNLOCKED', 'diamond sale unlock message');
player.note = 'UNCHANGED';
unlockPaint('CYAN');
assert(player.note === 'UNCHANGED', 'cyan only announces once');
syncPaintUnlocks(undefined);
assert(paintUnlocked(colors.cyan), 'no authoritative mask preserves the optimistic unlock');
syncPaintUnlocks(100);
assert(!paintUnlocked(colors.cyan), 'unchanged authoritative mask rolls back a rejected diamond-sale unlock');
unlockPaint('CYAN', 'DIAMOND SOLD');
syncPaintUnlocks(116);
assert(paintUnlocked(colors.cyan), 'updated authoritative mask preserves an accepted unlock');

// Rebuild hulls without duplicating mounts or resurrecting destroyed cargo.
lowerMount.hull.health=1.11111;
const hullRepairCost=ship.repairCost();
const hullRepairCredits=player.credits;
applyCraftAction(ship,{action:'repair'});
assert(lowerMount.hull.health===lowerMount.hull.module.health, 'hull repair');
assert.equal(player.credits,hullRepairCredits-hullRepairCost, 'hull repair charges for missing HP');
assert.deepEqual(sentActions.at(-1),{action:'repair'}, 'hull repair sends its own dock action');
const damaged = new Ship({shades: colors.white}).addToScene();
const spare = new CargoHatch();
const lost = new CargoHatch();
damaged.cargoContents.push(spare, lost);
const lostMount = damaged.mounts[0];
damaged.fit(lost, lostMount);
const oldMountCount = damaged.mounts.length;
lostMount.hull.health = 0;
damaged.update(0);
assert(!damaged.modules.includes(lost) && damaged.modules[0] === spare, 'lost hull removes equipped ownership');
assert(damaged.mounts.length === oldMountCount - 1, 'lost hull removes its mount');
damaged.fixHull(); damaged.fixHull();
assert(damaged.mounts.length === oldMountCount, 'repair restores mounts exactly once');
assert(damaged.cargoContents.length === 1 && damaged.cargoContents[0] === spare, 'repair does not restore lost modules');

// A destroyed module becomes wreckage, not a free module in the hold.
const brokenMount = damaged.mounts.find(slot => slot.fits.includes(CargoHatch));
damaged.fit(spare, brokenMount);
const segment = damaged.segmentsAtMount(brokenMount)[0];
segment.active = 1;
const attachedDoor = segment.points(segment).map(([x,y]) => Vec.add(segment.localPosition, Vec.create(x,y)));
damage(segment, CargoHatch.healthActivated);
damaged.update(0);
assert(!damaged.modules.length && !damaged.cargoContents.length && !brokenMount.module, 'destroyed module removed');
assert(!damaged.segmentsAtMount(brokenMount).length, 'destroyed geometry detached');
const wreckage = game.crafts.at(-1);
assert(wreckage !== damaged && wreckage.decay && wreckage.hitbox().length, 'detached cargo hatch remains physical wreckage');
assert.equal(wreckage.segments.length, 1, 'detached cargo hatch leaves only its physical door');
assert(!wreckage.segments[0].catches, 'detached cargo hatch omits its cargo contact point');
assert.deepEqual(wreckage.shades, colors.violet, 'detached cargo hatch retains its pink module color');
assert.equal(wreckage.segments[0].fillShade, 2, 'detached cargo hatch keeps its light fill shade');
const hatchShapeOutline = wreckage.segments[0].points;
assert.deepEqual(hatchShapeOutline.map(([x,y]) => Vec.add(wreckage.position, Vec.create(x,y))), attachedDoor,
  'detached cargo hatch starts at its mounted door geometry');
const hatchMiddle = hatchShapeOutline
  .reduce(([sumX,sumY],[x,y]) => [sumX+x,sumY+y],[0,0])
  .map(sum => sum/hatchShapeOutline.length);
assert(Math.hypot(wreckage.segments[0].localPosition.x+hatchMiddle[0],wreckage.segments[0].localPosition.y+hatchMiddle[1]) < 1e-9,
  'detached cargo hatch is centered on its existing door shapeOutline');
assert(wreckage.hitbox()[0].radius < 9, 'detached cargo hatch collision fits the narrow strip');

// Scoop doors still suppress their hull collision only while sufficiently open.
const hatchShip = new Ship({shades: colors.white}).addToScene();
const hatchModule = new CargoHatch();
hatchShip.cargoContents.push(hatchModule); hatchShip.fit(hatchModule);
const hatchMount = hatchModule.mount;
const hatchDoor = hatchShip.segmentsAtMount(hatchMount).find(segment => !segment.catches);
assert(hatchShip.hitbox().find(box => box.segment === hatchMount.hull).physics, 'closed cargo hatch hull blocks');
assert.equal(hatchShip.hitbox().find(box => box.segment === hatchDoor).collides, false,
  'closed cargo hatch door does not collide');
hatchShip.segmentsAtMount(hatchMount).forEach(segment => { segment.active = 1; segment.activationProgress = 1; });
assert(!hatchShip.hitbox().find(box => box.segment === hatchMount.hull).physics, 'open cargo hatch hull admits cargo');
assert.equal(hatchShip.hitbox().find(box => box.segment === hatchDoor).collides, true,
  'open cargo hatch door collides');
hatchShip.segmentsAtMount(hatchMount).forEach(segment => { segment.active = 0; segment.activationProgress = 0; });
assert.equal(hatchShip.hitbox().find(box => box.segment === hatchDoor).collides, false,
  'closing the cargo hatch removes door contacts again');
// The starter loadout is owned once and completely fitted by player setup.
assert(player.ship.modules.length === mustang.initialLoadout.length && !player.ship.cargoContents.length, 'starter cargo contents');
assert(new Set(player.ship.modules).size === mustang.initialLoadout.length, 'starter modules are distinct instances');
assert(player.ship.modules.every(module => module.mount.module === module), 'starter mount links');
assert(new CargoHatch().shades === colors.violet && new ShieldGenerator().shades === colors.violet &&
  thrusters.every((thruster) => new thruster().shades === colors.violet), 'purchased modules are pink');
assert(new HornDrill().shades === colors.yellow, 'purchased horns are yellow');
assert(ThrusterSingleMd.name === 'Thruster md' && ThrusterSingleMd.forwardThrust === 22, 'single thruster');
const flyer = new Ship({shades: colors.white}).addToScene();
const engine = new ThrusterDualMd();
flyer.cargoContents.push(engine); flyer.fit(engine);
for (const forward of [0, 1]) {
  for (const turn of [-1, 0, 1]) {
    flyer.fly(forward, turn);
    flyer.segmentsAtMount(engine.mount).forEach(segment => {
      const side = segment.thrusterNozzleSide;
      const expected = !turn || !side ? forward : turn === -side ? 1 : forward * 0.5;
      assert(segment.active === expected, 'nozzle steering behavior');
    });
  }
}
flyer.fly(1, 1); flyer.update(0.1);
assert(Number.isFinite(flyer.position.x) && Number.isFinite(flyer.spin), 'flight remains finite');
flyer.fit(0, engine.mount);
assert(flyer.forwardThrust === 0 && flyer.cargoContents[0] === engine, 'removing engine removes thrust');
// Check actual launch motion, including the final 0.05-second full-power pulse:
// coast uses quarter thrust and speed cap, with half-size flames.
for (const type of thrusters) {
  const departing = new Ship({hullSegments:thrusterHull,shades: colors.white, position: Vec.create(100000, 100000)}).addToScene();
  const engine = new type();
  departing.cargoContents.push(engine); departing.fit(engine);
  departing.launch();
  let timer = 3;
  let expectedSpeed = 0;
  let expectedX = departing.position.x;
  const dt = 1 / 60;
  for (let frame = 0; frame < 240; frame++) {
    const launching = timer > 0;
    timer = Math.max(0, timer - dt);
    const fraction = timer > 0.05 && timer <= 2 ? 0.25 : 1;
    const forward = launching ? 1 : 0;
    const cap = 17 * type.forwardThrust * fraction;
    expectedSpeed += 220 * type.forwardThrust * fraction / departing.mass * forward * dt;
    if (expectedSpeed < 1) expectedSpeed = 0;
    // Normal drag still slows a ship when the launch speed cap changes.
    const draggedSpeed = expectedSpeed * Math.exp(-departing.drag * dt);
    expectedSpeed = expectedSpeed > cap ? Math.min(draggedSpeed, Math.max(cap, expectedSpeed * 0.9)) :
      draggedSpeed;
    expectedX = roundMotion(expectedX + expectedSpeed * dt);
    expectedSpeed = roundMotion(expectedSpeed);
    departing.fly(departing.launching ? 1 : 0, 0);
    departing.update(dt);
    assert(Math.abs(Vec.length(departing.velocity) - expectedSpeed) < 1e-8,
      type.name + ': launch speed matches expected each frame');
    assert(Math.abs(departing.position.x - expectedX) < 1e-7,
      type.name + ': launch distance matches expected each frame');
    assert.equal(departing.maxSpeed, cap, type.name + ': coast lowers actual speed cap at frame ' + frame);
    assert(departing.segmentsAtMount(engine.mount).every(segment => segment.active === forward * Math.sqrt(fraction)),
      type.name + ': launch nozzle activation');
  }
  departing.launch();
  timer = 3;
  let expectedSpin = departing.spin;
  for (let frame = 0; frame < 180; frame++) {
    timer = Math.max(0, timer - dt);
    const fraction = timer > 0.05 && timer <= 2 ? 0.25 : 1;
    const thrust = type.rotationalThrust * fraction;
    const target = departing.turnRate * thrust * fraction / 16;
    expectedSpin = roundMotion(expectedSpin + Math.max(-thrust * dt, Math.min(thrust * dt, target - expectedSpin)));
    departing.fly(departing.launching ? 1 : 0, 1);
    departing.update(dt);
    assert(Math.abs(departing.spin - expectedSpin) < 1e-8,
      type.name + ': launch steering matches expected each frame');
  }
  engine.mount.health = 0;
  assert(departing.forwardThrust === 0 && departing.rotationalThrust === 0,
    'broken engine supplies no thrust');
  departing.remove();
}
// All nozzles on all craft draw their flares before any glow, then hulls.
// Exercise the real renderer for each engine layout and both craft orders.
for (const type of thrusters) {
  const draws = [];
  let saves = 0;
  const ctx = {
    save() { saves++; }, restore() { saves--; },
    translate() {}, rotate() {}, scale() {}, beginPath() {}, arc() {}, stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fill(path) { draws.push(path ? path.kind : 'glow'); },
  };
  const crafts = [0, 1].map(() => {
    const craft = new Ship({ hullSegments:thrusterHull, shades: colors.white }).addToScene();
    const engine = new type();
    craft.cargoContents.push(engine);
    craft.fit(engine);
    game.ctx = ctx;
    craft.segments.forEach(segment => {
      segment.activationProgress = 1;
      segment.path = () => ({ kind: segment.module.forwardThrust ? 'flare' : 'hull' });
    });
    return craft;
  });
  const render = () => {
    draws.length = 0;
    for (const layer of Object.values(renderingLayers)) crafts.forEach(craft => craft.render({zIndex:layer}));
    assert(saves === 0, 'renderer balances canvas state');
  };
  for (let order = 0; order < 2; order++) {
    render();
    const count = type.model.length * 2;
    assert(draws.slice(0, count).length === count && draws.slice(0, count).every(kind => kind !== 'glow'),
      type.name + ': every flare precedes all glows');
    assert(draws.slice(count, count * 2).length === count && draws.slice(count, count * 2).every(kind => kind === 'glow'),
      type.name + ': glows share one layer across craft');
    assert(draws.slice(count * 2).every(kind => kind !== 'glow'),
      'hulls remain above the glow layer');
    crafts.reverse();
  }
  crafts[0].segments.forEach(segment => segment.activationProgress = 0);
  crafts[1].engine.mount.health = 0;
  render();
  assert(!draws.includes('glow'), 'inactive and broken thrusters emit no glow');
  crafts.forEach(craft => craft.remove());
}

// Check paint rewards under production minification too.
assert(paintUnlocked(colors.yellow), 'YELLOW starts unlocked');
assert(!paintUnlocked(colors.green), 'GREEN starts locked');
unlockPaint('GREEN', '3 STATION VISITS');
assert(paintUnlocked(colors.green), 'GREEN unlocks its paint');
assert.equal(player.note, '3 STATION VISITS - GREEN UNLOCKED');
player.note = 'UNCHANGED';
unlockPaint('GREEN');
assert.equal(player.note, 'UNCHANGED', 'GREEN only announces once');
const replacement = new Ship({shades:colors.white}).addToScene();
const spareShip = new Ship({shades:colors.yellow});
const ownedShips = player.ships;
player.ships.push(spareShip);
player.ship.docked(new Ship({id:700}));
player.ship.docked(new Ship({id:700}));
assert(player.visitedStations.size === 1, 'recreated station objects count as the same visit');
player.note = 'SHIP REPLACED';
player.noteFor = 7;
player.queuedNotes.push('NEXT MESSAGE');
player.hudAlpha = 0.5;
player.started = true;
const creditsBefore = player.credits;
const paintsBefore = [...player.unlockedPaints];
const notesBefore = [...player.queuedNotes];
const updateBefore = replacement.update;
adoptPlayerShip({ship:replacement});
assert(player.ship === replacement, 'presentation adopts the canonical simulation object');
assert(player.ships === ownedShips, 'ship adoption preserves the owned-ships array');
assert.deepEqual(player.ships, [replacement, spareShip], 'replacing the active ship retains other owned ships');
assert(player.credits === creditsBefore, 'credits survive ship replacement');
assert.deepEqual(player.unlockedPaints, paintsBefore, 'paint unlocks survive ship replacement');
assert.deepEqual(player.queuedNotes, notesBefore, 'queued notes survive ship replacement');
assert(player.note === 'SHIP REPLACED' && player.noteFor === 7,
  'current note survives ship replacement');
assert(player.hudAlpha === 0.5 && player.started, 'HUD state survives ship replacement');
replacement.docked(new Ship({id:701}));
assert(player.visitedStations.size === 2, 'new ship retains the docking reward callback and visit history');
assert(player.ship.update === updateBefore, 'decoration does not replace shared physics');
adoptPlayerShip({ship:replacement});
assert(!replacement.dead && game.sprites.includes(replacement), 'adopting the current ship does not remove it');
assert(player.ships.length === 2 && player.ships[1] === spareShip,
  'adopting the current ship does not duplicate it or remove other owned ships');
console.log('Cargo contents, dock actions, damage, repairs, cargo hatch physics and flight tests passed');
`;

for (const production of [false, true]) {
  const entryId = `${process.cwd()}/src/__docked_test.ts`;

  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'docked-test-entry',
        resolveId: (id) => {
          if (id === entryId) return entryId;
        },
        load: (id) => {
          if (id === entryId) {
            return stripIfdef(
              production
                ? scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  )
                : scenario,
            );
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

  Object.assign(globalThis, { canvas: { getContext: () => ({}) } });
  Object.assign(globalThis, { location: { search: '' } });

  Object.assign(globalThis, {
    Path2D: class {
      arc() {}

      closePath() {}

      lineTo() {}

      moveTo() {}
    },
  });

  const code = output[0].code;

  await import(`data:text/javascript,${encodeURIComponent(code)}`);
}
