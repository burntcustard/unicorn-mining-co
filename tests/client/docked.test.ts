/* global process */
import '../support/audio-context.ts';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';
import { rolldown } from 'rolldown';

// Exercise the mechanics and assertions together under production transforms.
// The separate lazy-docked test checks the actual module boundary.
const scenario = `
import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
import { roundMotion } from '${process.cwd()}/src/client/utilities/round.ts';
import assert from 'node:assert/strict';
import { renderingLayers } from '${process.cwd()}/src/definitions/rendering-layers.ts';
import { damage } from '${process.cwd()}/src/client/objects/damage.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { diamond as diamondDefinition, itemTypes, message as messageDefinition } from '${process.cwd()}/src/definitions/items/index.ts';
import { CargoHatch, HornDrill, ShieldGenerator, ThrusterDualMd, ThrusterDualXl, ThrusterSingle, ThrusterTriple, thrusters } from '${process.cwd()}/src/client/objects/modules/index.ts';
import { Item } from '${process.cwd()}/src/client/objects/item.ts';

import { setCraftActionDispatcher } from '${process.cwd()}/src/client/network/craft-actions.ts';
import { adoptPlayerShip, paintUnlocked, playerShip, readSlate, unlockPaint, updatePlayer } from '${process.cwd()}/src/client/player.ts';
import { game } from '${process.cwd()}/src/client/game.ts';
import { presentEvents } from '${process.cwd()}/src/client/effects/present-events.ts';
import { sparks } from '${process.cwd()}/src/client/effects/shrapnel.ts';
import { colors } from '${process.cwd()}/src/definitions/colors.ts';
import { back, confirmSelection, moveSelection, moveSubSelection, fitsOf, selectionSnapshot } from '${process.cwd()}/src/client/ui/docked.ts';

assert(colors.grey.join() === '#778,#99a,#bbc,#334,#eef');
assert(colors.black.join() === '#000,#111,#222,#879,#200');
assert(colors.indigo.join() === '#33c,#44d,#55f,#217,#bdf');
assert(colors.purple.join() === '#102,#213,#325,#001,#647');
// Reward lookup must not depend on the palette object's enumeration order.
const redShades = colors.red;
delete colors.red;
colors.red = redShades;
const noteBeforeUnknownReward = playerShip.note;
assert(unlockPaint('UNKNOWN', 'TEST') === undefined);
assert(playerShip.note === noteBeforeUnknownReward);

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

const ship = new Ship({ shades: colors.white, credits: 10000 }).addToScene();
assert.equal(ship.hullMaxHealth, 186, 'Ship hull has twice its original 93 HP');
const pendingSales = [];
const pendingRepairs = [];
setCraftActionDispatcher(action => {
  if (action.action === 'sell') pendingSales.push(action);
  if (action.action === 'repair') pendingRepairs.push(action);
});
const settleSale = () => {
  const request = pendingSales.shift();
  assert(request?.objectIds.length, 'sale sends exact cargo IDs');
  const sold = ship.cargoContents.filter(object => request.objectIds.includes(object.id));
  assert.equal(sold.length, request.objectIds.length);
  ship.cargoContents = ship.cargoContents.filter(object => !request.objectIds.includes(object.id));
  ship.credits += sold.reduce((total, object) => total + object.price, 0);
};
const wreck = new Ship({ shades: colors.white, velocity: Vec.create(12, -7), spin: 0.2 }).addToScene();
const contents = [diamondDefinition, messageDefinition, messageDefinition].map(itemData =>
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
const second = new CargoHatch();
const first = new CargoHatch();
first.shades = colors.red;
second.shades = colors.orange;
ship.cargoContents.push(first, second);
const mount = ship.mounts[0];
const confirm = () => confirmSelection(ship);
const move = (delta) => moveSelection(delta, ship);
const check = (selected, message) => {
  const rows = fitsOf(ship, mount);
  assert(rows[0] === first && rows[1] === second, message + ': stable rows');
  const [row, stage] = selectionSnapshot();
  assert(rows[row] === selected && stage === 2, message + ': same instance submenu');
};

move(2); confirm(); move(1); confirm();
check(second, 'before equip');
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from EQUIP jumps directly to the paint row');
move(-1);
assert(selectionSnapshot(ship)[3] === 0, 'up from paint returns to EQUIP');
confirm();
assert(mount.module === second, 'equip second instance');
check(second, 'after equip');
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from REMOVE on an equipped hatch reaches paint');
move(-1);
assert(selectionSnapshot(ship)[3] === 0,
  'up from equipped hatch paint returns to REMOVE');
confirm();
assert(!mount.module && ship.cargoContents.includes(second), 'remove second instance');
check(second, 'after remove');

back(ship); move(-1); confirm(); confirm();
assert(mount.module === first, 'equip first instance');
check(first, 'first equipped');
back(ship); move(1); confirm(); confirm();
assert(mount.module === second && ship.cargoContents.includes(first), 'swap fitted instances');
check(second, 'after swap');
assert(first.shades === colors.red && second.shades === colors.orange, 'paint identity');
assert(ship.segments.filter(segment => segment.mount === mount).every(segment => segment.shades === colors.orange), 'equipped paint');

confirm();
check(second, 'remove swapped instance');
moveSubSelection(1, ship); confirm();
assert(ship.cargoContents.includes(second), 'sale waits for the server snapshot');
settleSale();
assert(!ship.cargoContents.includes(second) && ship.cargoContents.includes(first), 'sell selected instance');
assert(fitsOf(ship, mount)[0] === first && selectionSnapshot()[0] === 0 && selectionSnapshot()[1] === 1, 'sale closes on replacement');
move(1);
assert(selectionSnapshot()[0] === fitsOf(ship, mount).length, 'down reaches BACK after module sale');
confirm();
assert(selectionSnapshot()[1] === 0, 'BACK leaves module list');
confirm();
// An equipped instance on another mount must not be offered or counted as cargo.
const lowerMount = ship.mounts[5];
ship.fit(first, lowerMount);
assert(fitsOf(ship, mount)[0] === CargoHatch, 'other mount only offers a new type');
assert(!ship.cargoContents.length && ship.modules[0] === first, 'fitting preserves ownership');

// Buy through the menu, paint, repair, and remove the exact purchased instance.
back(ship); move(-100); move(2); confirm(); confirm();
const beforeBuy = ship.credits;
move(1);
assert(selectionSnapshot(ship)[3] === 1, 'down from BUY reaches BACK');
move(-1);
confirm();
const bought = ship.modules[1];
assert(bought.constructor === CargoHatch && bought !== first, 'purchase appends a fresh instance');
assert(ship.credits === beforeBuy - CargoHatch.price, 'purchase debits once');
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from EQUIP after buying reaches the paint row');
move(-1);
assert(selectionSnapshot(ship)[3] === 0, 'up from paint returns to EQUIP after buying');
confirm();
assert(mount.module === bought && !ship.cargoContents.length, 'new purchase fits');
// Navigation skips locked colours: a new pilot has only yellow, pink and white.
assert(!paintUnlocked(colors.red) && !paintUnlocked(colors.orange), 'red and orange start locked');
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from REMOVE reaches the paint row after equipping');
move(-1);
moveSubSelection(1, ship);
assert(selectionSnapshot()[3] === 1, 'right reaches BACK after equipping');
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from BACK reaches the paint row');
move(-1);
assert(selectionSnapshot(ship)[3] === 1, 'up from paint returns to BACK');
move(1); moveSubSelection(-100, ship); confirm();
assert(bought.shades === colors.yellow, 'first unlocked paint is yellow');
moveSubSelection(1, ship); confirm();
assert(bought.shades === colors.violet && first.shades === colors.red, 'next unlocked paint is pink');

// The ownership checks below need these paints earned before selecting them.
unlockPaint('RED', 'DAMAGED');
assert(playerShip.note === 'DAMAGED - RED UNLOCKED', 'red reward message');
const slatePickup = {type:'itemCollected',itemId:999,resource:4,unlock:'ORANGE',message:'GOLD ORE 100/200'};
const noteBeforeOtherPickup = playerShip.note;
presentEvents({playerId:1,events:[{...slatePickup,by:2}],onMessage:readSlate});
assert(!paintUnlocked(colors.orange) && playerShip.note === noteBeforeOtherPickup,
  'another player reading a slate does not show our message or unlock');
presentEvents({playerId:1,events:[{...slatePickup,by:1}],onMessage:readSlate});
assert(paintUnlocked(colors.red) && paintUnlocked(colors.orange), 'earned paints become available');
assert(playerShip.note === 'CARGO FOUND - ORANGE UNLOCKED', 'orange unlock appears first');
updatePlayer(10);
assert(playerShip.note === 'GOLD ORE 100/200', 'field coordinates follow the unlock');
playerShip.noteFor = 0;
presentEvents({playerId:1,events:[{...slatePickup,by:1,message:'AMETHYST CLUSTER 300/400'}],onMessage:readSlate});
assert(playerShip.note === 'AMETHYST CLUSTER 300/400', 'already unlocked orange shows coordinates only');
moveSubSelection(-100, ship); confirm();
assert(bought.shades === colors.red && first.shades === colors.red, 'paint purchased instance');
moveSubSelection(1, ship); confirm();
assert(bought.shades === colors.orange && first.shades === colors.red, 'independent paint');
back(ship); mount.health = 3.11111;
const repairCredits = ship.credits;
ship.credits = 0; confirm();
assert(selectionSnapshot(ship)[2][0] === 'FIX' && selectionSnapshot(ship)[3] === 2,
  'unaffordable module repair is visible but cannot be focused');
move(1); move(-1);
assert(selectionSnapshot(ship)[3] === 2, 'up from paints skips disabled repair for BACK');
ship.credits = repairCredits; back(ship); confirm();
move(1);
assert(selectionSnapshot(ship)[3] > selectionSnapshot(ship)[2].length,
  'down from FIX on a horizontal action row reaches paint, not BACK');
move(-1);
assert(selectionSnapshot(ship)[3] === 0,
  'up from paint returns to FIX on a horizontal action row');
confirm();
assert(mount.health === CargoHatch.health && ship.credits === repairCredits - 1,
  'module repair charges for displayed missing HP');
assert.deepEqual(pendingRepairs.shift(),
  {action: 'repair', moduleId: bought.id, mount: ship.mounts.indexOf(mount)},
  'module repair sends its mounted instance');
confirm();
assert(!bought.mount && ship.cargoContents[0] === bought, 'removed instance becomes cargo');

// Capacity counts loose modules and physical cargo, excluding fitted modules.
const ore = {...diamondDefinition,label:'ORE',price:7};
const gem = {...diamondDefinition,label:'DIAMOND',price:11};
ship.cargoContents.push(...Array.from({length: 11}, () => new Item(ore)));
assert(ship.cargoContents.length >= ship.cargoSpace, 'loose module fills twelfth cargo space');
ship.fit(bought, mount);
assert((ship.cargoContents.length < ship.cargoSpace), 'equipping frees cargo space');
ship.fit(0, mount);
assert(ship.cargoContents.length >= ship.cargoSpace, 'removing consumes cargo space');

// Full cargo blocks a purchase without altering cargo contents or credits.
back(ship); back(ship); move(-100); move(3); confirm();
const buyCredits = ship.credits;
ship.credits = 0; confirm();
assert(selectionSnapshot(ship)[2][0] === 'BUY' && selectionSnapshot(ship)[3] === 1,
  'unaffordable purchase is visible but cannot be focused');
ship.credits = buyCredits; back(ship); confirm();
const fullCredits = ship.credits;
confirm();
assert(ship.credits === fullCredits && ship.modules.length === 2, 'full cargo blocks buy');
back(ship); back(ship); move(-100);
ship.cargoContents = [bought, new Item(ore), new Item(gem), new Item(ore)];
const beforeSale = ship.credits;
confirm(); confirm(); confirm(); settleSale();
assert(ship.modules.length === 1 && ship.modules[0] === first, 'cargo sale preserves equipped module');
assert(selectionSnapshot()[1] === 1, 'cargo sale closes submenu');
move(1); move(1);
assert(selectionSnapshot()[0] === 2, 'down reaches BACK after cargo sale');
confirm(); confirm();
confirm(); confirm(); settleSale();
assert(ship.cargoContents.length === 1 && ship.cargoContents[0].item === gem, 'ore stack sale');
assert(selectionSnapshot()[1] === 1, 'stack sale closes submenu');
assert(!paintUnlocked(colors.cyan), 'cyan is locked before selling a diamond');
confirm(); confirm(); settleSale();
assert(!ship.cargoContents.length && ship.credits === beforeSale + CargoHatch.price + 25, 'last cargo sale');
assert(selectionSnapshot()[1] === 1, 'empty cargo returns to list');
assert(paintUnlocked(colors.cyan) && playerShip.note === 'DIAMOND SOLD - CYAN UNLOCKED', 'diamond sale unlocks cyan with its name');
playerShip.note = 'UNCHANGED';
unlockPaint('CYAN');
assert(playerShip.note === 'UNCHANGED', 'cyan only announces once');

// Rebuild hulls without duplicating mounts or resurrecting destroyed cargo contents.
confirm(); move(1); confirm();
lowerMount.hull.health = 1.11111;
const hullHealth = ship.segments.filter(({hull}) => hull).reduce((total, segment) => total + segment.health, 0);
const hullMaxHealth = ship.hullSegments.reduce((total, segment) => total + segment.health, 0);
const hullRepairCredits = ship.credits;
confirm();
assert(lowerMount.hull.health === lowerMount.hull.module.health, 'hull repair');
assert(ship.credits === hullRepairCredits - hullMaxHealth + (hullHealth | 0),
  'hull repair charges for displayed missing HP');
assert.deepEqual(pendingRepairs.shift(), {action: 'repair'},
  'hull repair sends its own dock action');
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
damage(segment, CargoHatch.health);
damaged.update(0);
assert(!damaged.modules.length && !damaged.cargoContents.length && !brokenMount.module, 'destroyed module removed');
assert(!damaged.segmentsAtMount(brokenMount).length, 'destroyed geometry detached');
const wreckage = game.crafts.at(-1);
assert(wreckage !== damaged && wreckage.decay && wreckage.hitbox().length, 'detached cargo hatch remains physical wreckage');
assert.equal(wreckage.segments.length, 1, 'detached cargo hatch leaves only its physical door');
assert(!wreckage.segments[0].catches, 'detached cargo hatch omits its cargo contact point');
assert.deepEqual(wreckage.shades, colors.violet, 'detached cargo hatch retains its pink module colour');
assert.equal(wreckage.segments[0].fillShade, 2, 'detached cargo hatch keeps its light fill shade');
const hatchShapeOutline = wreckage.segments[0].points;
assert.deepEqual(hatchShapeOutline.map(([x,y]) => Vec.add(wreckage.position, Vec.create(x,y))), attachedDoor,
  'detached cargo hatch starts at its mounted door geometry');
const hatchMiddle = hatchShapeOutline
  .reduce(([sumX,sumY],[x,y]) => [sumX+x,sumY+y],[0,0])
  .map(sum => sum/hatchShapeOutline.length);
assert(Math.hypot(wreckage.segments[0].localPosition.x+hatchMiddle[0],wreckage.segments[0].localPosition.y+hatchMiddle[1]) < 1e-9,
  'detached cargo hatch is centred on its existing door shapeOutline');
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
assert(playerShip.modules.length === 5 && !playerShip.cargoContents.length, 'starter cargo contents');
assert(new Set(playerShip.modules).size === 5, 'starter modules are distinct instances');
assert(playerShip.modules.every(module => module.mount.module === module), 'starter mount links');
assert(new CargoHatch().shades === colors.violet && new ShieldGenerator().shades === colors.violet &&
  thrusters.every((thruster) => new thruster().shades === colors.violet), 'purchased modules are pink');
assert(new HornDrill().shades === colors.yellow, 'purchased horns are yellow');
assert(ThrusterSingle.label === 'THRUSTERS *1 XL' && ThrusterSingle.forwardThrust === 22, 'single thruster');
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
for (const type of [ThrusterDualMd, ThrusterDualXl, ThrusterSingle, ThrusterTriple]) {
  const departing = new Ship({shades: colors.white, position: Vec.create(100000, 100000)}).addToScene();
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
      type.label + ': launch speed matches expected each frame');
    assert(Math.abs(departing.position.x - expectedX) < 1e-7,
      type.label + ': launch distance matches expected each frame');
    assert(departing.maxSpeed === cap, type.label + ': coast lowers actual speed cap');
    assert(departing.segmentsAtMount(engine.mount).every(segment => segment.active === forward * Math.sqrt(fraction)),
      type.label + ': launch nozzle activation');
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
      type.label + ': launch steering matches expected each frame');
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
    const craft = new Ship({ shades: colors.white }).addToScene();
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
      type.label + ': every flare precedes all glows');
    assert(draws.slice(count, count * 2).length === count && draws.slice(count, count * 2).every(kind => kind === 'glow'),
      type.label + ': glows share one layer across craft');
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

// Check the remaining reward names under production minification too.
assert(paintUnlocked(colors.yellow), 'YELLOW starts unlocked');

for (const [name, shades] of [['GREEN', colors.green]]) {
  assert(!paintUnlocked(shades), name + ' starts locked');
  unlockPaint(name, '3 STATION VISITS');
  assert(paintUnlocked(shades), name + ' unlocks its paint');
  assert(playerShip.note === '3 STATION VISITS - GREEN UNLOCKED', name + ' reward message');
  playerShip.note = 'UNCHANGED';
  unlockPaint(name);
  assert(playerShip.note === 'UNCHANGED', name + ' only announces once');
}
const replacement = new Ship({shades:colors.white}).addToScene();
const creditsBefore = playerShip.credits;
const updateBefore = replacement.update;
adoptPlayerShip({ship:replacement});
assert(playerShip === replacement, 'presentation adopts the canonical simulation object');
assert(playerShip.credits === creditsBefore, 'presentation survives snapshot object replacement');
assert(playerShip.update === updateBefore, 'decoration does not replace shared physics');
adoptPlayerShip({ship:replacement});
assert(!replacement.dead && game.sprites.includes(replacement), 'adopting the current ship does not remove it');
console.log('Cargo contents, menu, damage, repairs, cargo hatch physics and flight tests passed');
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
        transform: (code, id) =>
          id.endsWith('/src/client/ui/docked.ts')
            ? `${code}\nexport { fitsOf };\nexport const selectionSnapshot = ship => [moduleOption, stage, ship && selectionOf(ship).actions, focused];`
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
