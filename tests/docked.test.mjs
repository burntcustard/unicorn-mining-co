/* global process */
import './audio-context.mjs';
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import viteConfig from '../vite.config.js';
import { viteJs13kPre } from '../plugins/vite-js13k.js';

// Keep the assertions in the bundle so production property mangling applies
// consistently to both the game objects and the checks that inspect them.
const scenario = `
import assert from 'node:assert/strict';
import { Ship, damage } from '${process.cwd()}/src/ship.js';
import { Item } from '${process.cwd()}/src/item.js';
import { diamond, message } from '${process.cwd()}/src/items/index.js';
import { instanceOf, cargoScoop, horn, shield, thrusterDualMd, thrusterDualXl, thrusterSingle, thrusterTriple, thrusters } from '${process.cwd()}/src/modules/index.js';
import { colorUnlocked, roomFor, playerShip, unlockColor, updatePlayer } from '${process.cwd()}/src/player.js';
import { launch, flyOut } from '${process.cwd()}/src/docking.js';
import { game } from '${process.cwd()}/src/game.js';
import { colors } from '${process.cwd()}/src/colors.js';
import {
  back, confirmSelection, moveSelection, moveSubSelection,
  fitsOf, selectionSnapshot,
} from '${process.cwd()}/src/ui/docked.js';

// A hull section destroyed by an impact also breaks off as short-lived,
// physical wreckage instead of disappearing with the surviving hull's split.
const battered = new Ship({shades: colors.white});
const corner = battered.segments.find(({ hull, health }) => hull && health === 4);
corner.health = 0;
battered.update(0);
const hullWreckage = game.crafts.at(-1);
assert(hullWreckage !== battered && hullWreckage.decay && hullWreckage.hitboxes().length,
  'destroyed hull remains as physical wreckage');

const ship = new Ship({ shades: colors.white, credits: 10000 });
const wreck = new Ship({ shades: colors.white, dx: 12, dy: -7, spin: 0.2 });
const contents = [diamond, message, message].map(itemData => new Item({ itemData }));
contents.forEach(item => item.remove());
wreck.cargo.push(...contents);
wreck.cockpit.health = 0;
wreck.update(0);
assert(wreck.dead, 'destroyed ship is removed');
for (const item of contents) {
  assert(!item.dead && game.sprites.includes(item), 'cargo and every message are released');
  assert(Math.abs(item.velocity.subtract(wreck.velocity).length() - 5) < 1e-9,
    'released contents receive an outward impulse');
  assert(Math.abs(item.spin) <= 0.5 / item.mass,
    'released contents receive a small random impulse without inheriting ship spin');
}
assert(new Set(contents.map(item => item.spin)).size > 1, 'contents tumble independently');
const second = instanceOf(cargoScoop);
const first = instanceOf(cargoScoop);
first.shades = colors.red;
second.shades = colors.orange;
ship.modules.push(first, second);
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
confirm();
assert(mount.module === second, 'equip second instance');
check(second, 'after equip');
confirm();
assert(!mount.module && ship.cargoBay.includes(second), 'remove second instance');
check(second, 'after remove');

back(ship); move(-1); confirm(); confirm();
assert(mount.module === first, 'equip first instance');
check(first, 'first equipped');
back(ship); move(1); confirm(); confirm();
assert(mount.module === second && ship.cargoBay.includes(first), 'swap fitted instances');
check(second, 'after swap');
assert(first.shades === colors.red && second.shades === colors.orange, 'paint identity');
assert(ship.segments.filter(part => part.mount === mount).every(part => part.shades === colors.orange), 'equipped paint');

confirm();
check(second, 'remove swapped instance');
moveSubSelection(1, ship); confirm();
assert(!ship.cargoBay.includes(second) && ship.cargoBay.includes(first), 'sell selected instance');
assert(fitsOf(ship, mount)[0] === first && selectionSnapshot()[0] === 0 && selectionSnapshot()[1] === 1, 'sale closes on replacement');
// An equipped instance on another mount must not be offered or counted as cargo.
const lowerMount = ship.mounts[5];
ship.fit(first, lowerMount);
assert(fitsOf(ship, mount)[0] === cargoScoop, 'other mount only offers a new type');
assert(!ship.cargoBay.length && ship.modules[0] === first, 'fitting preserves ownership');

// Buy through the menu, paint, repair, and remove the exact purchased instance.
back(ship); move(-100); move(2); confirm(); confirm();
const beforeBuy = ship.credits;
confirm();
const bought = ship.modules[1];
assert(bought.oneOf === cargoScoop && bought !== first, 'purchase appends a fresh instance');
assert(ship.credits === beforeBuy - cargoScoop.price, 'purchase debits once');
confirm();
assert(mount.module === bought && !ship.cargoBay.length, 'new purchase fits');
// Navigation skips locked colours: a new pilot has only pink and white.
assert(!colorUnlocked(colors.red) && !colorUnlocked(colors.orange), 'red and orange start locked');
move(1); moveSubSelection(-100, ship); confirm();
assert(bought.shades === colors.violet, 'first unlocked paint is pink');
moveSubSelection(1, ship); confirm();
assert(bought.shades === colors.white && first.shades === colors.red, 'next unlocked paint is white');

// The ownership checks below need these paints earned before selecting them.
unlockColor('RED', 'DAMAGED');
assert(playerShip.note === 'DAMAGED - RED UNLOCKED', 'red reward message');
unlockColor('ORANGE', 'CARGO FOUND');
assert(colorUnlocked(colors.red) && colorUnlocked(colors.orange), 'earned paints become available');
assert(playerShip.note === 'CARGO FOUND - ORANGE UNLOCKED', 'orange reward message');
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
ship.credits = repairCredits; back(ship); confirm(); confirm();
assert(mount.health === cargoScoop.health && ship.credits === repairCredits - 1,
  'module repair charges for displayed missing HP');
confirm();
assert(!bought.mount && ship.cargoBay[0] === bought, 'removed instance becomes cargo');

// Capacity counts loose modules and physical cargo, excluding fitted modules.
const ore = { name: 'ORE', price: 7 };
const gem = { name: 'DIAMOND', price: 11 };
ship.cargo = Array.from({length: 11}, () => ({ item: ore }));
assert(!roomFor(ship), 'loose module fills twelfth cargo space');
ship.fit(bought, mount);
assert(roomFor(ship), 'equipping frees cargo space');
ship.fit(0, mount);
assert(!roomFor(ship), 'removing consumes cargo space');

// Full cargo blocks a purchase without altering inventory or credits.
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
ship.cargo = [{item: ore}, {item: gem}, {item: ore}];
const beforeSale = ship.credits;
confirm(); confirm(); confirm();
assert(ship.modules.length === 1 && ship.modules[0] === first, 'cargo sale preserves equipped module');
assert(selectionSnapshot()[1] === 1, 'cargo sale closes submenu');
confirm(); confirm();
assert(ship.cargo.length === 1 && ship.cargo[0].item === gem, 'ore stack sale');
assert(selectionSnapshot()[1] === 1, 'stack sale closes submenu');
assert(!colorUnlocked(colors.cyan), 'cyan is locked before selling a diamond');
confirm(); confirm();
assert(!ship.cargo.length && ship.credits === beforeSale + cargoScoop.price + 25, 'last cargo sale');
assert(selectionSnapshot()[1] === 1, 'empty cargo returns to list');
assert(colorUnlocked(colors.cyan) && playerShip.note === 'DIAMOND SOLD - CYAN UNLOCKED', 'diamond sale unlocks cyan with its name');
playerShip.note = 'UNCHANGED';
unlockColor('CYAN');
assert(playerShip.note === 'UNCHANGED', 'cyan only announces once');

// Rebuild hulls without duplicating mounts or resurrecting destroyed inventory.
confirm(); move(1); confirm();
lowerMount.hull.health = 1.11111;
const hullHealth = ship.segments.filter(({hull}) => hull).reduce((total, part) => total + part.health, 0);
const hullMaxHealth = ship.hullSegments.reduce((total, part) => total + part.health, 0);
const hullRepairCredits = ship.credits;
confirm();
assert(lowerMount.hull.health === lowerMount.hull.module.health, 'hull repair');
assert(ship.credits === hullRepairCredits - hullMaxHealth + (hullHealth | 0),
  'hull repair charges for displayed missing HP');
const damaged = new Ship({shades: colors.white});
const spare = instanceOf(cargoScoop);
const lost = instanceOf(cargoScoop);
damaged.modules.push(spare, lost);
const lostMount = damaged.mounts[0];
damaged.fit(lost, lostMount);
const oldMountCount = damaged.mounts.length;
lostMount.hull.health = 0;
damaged.update(0);
assert(!damaged.modules.includes(lost) && damaged.modules[0] === spare, 'lost hull removes equipped ownership');
assert(damaged.mounts.length === oldMountCount - 1, 'lost hull removes its mount');
damaged.fixHull(); damaged.fixHull();
assert(damaged.mounts.length === oldMountCount, 'repair restores mounts exactly once');
assert(damaged.cargoBay.length === 1 && damaged.cargoBay[0] === spare, 'repair does not restore lost modules');

// A destroyed module becomes debris, not a free module in the hold.
const brokenMount = damaged.mounts.find(slot => slot.fits.includes(cargoScoop));
damaged.fit(spare, brokenMount);
const part = damaged.partsOf(brokenMount)[0];
part.active = 1;
damage(part, cargoScoop.health);
damaged.update(0);
assert(!damaged.modules.length && !damaged.cargoBay.length && !brokenMount.module, 'destroyed module removed');
assert(!damaged.partsOf(brokenMount).length, 'destroyed geometry detached');
const debris = game.crafts.at(-1);
assert(debris !== damaged && debris.decay && debris.hitboxes().length, 'detached scoop remains physical debris');

// Scoop doors still suppress their hull collision only while sufficiently open.
const scoopShip = new Ship({shades: colors.white});
const scoopModule = instanceOf(cargoScoop);
scoopShip.modules.push(scoopModule); scoopShip.fit(scoopModule);
const scoopMount = scoopModule.mount;
assert(scoopShip.hitboxes().find(box => box.segment === scoopMount.hull).physics, 'closed scoop hull blocks');
scoopShip.partsOf(scoopMount).forEach(part => part.activationProgress = 1);
assert(!scoopShip.hitboxes().find(box => box.segment === scoopMount.hull).physics, 'open scoop hull admits cargo');
// The starter loadout is owned once and completely fitted by player setup.
assert(playerShip.modules.length === 5 && !playerShip.cargoBay.length, 'starter inventory');
assert(new Set(playerShip.modules).size === 5, 'starter modules are distinct instances');
assert(playerShip.modules.every(module => module.mount.module === module), 'starter mount links');
assert(instanceOf(cargoScoop).shades === colors.violet && instanceOf(shield).shades === colors.violet &&
  thrusters.every((thruster) => instanceOf(thruster).shades === colors.violet), 'purchased modules are pink');
assert(instanceOf(horn).shades === colors.yellow, 'purchased horns are yellow');
assert(thrusterSingle.name === 'THRUSTERS *1 XL' && thrusterSingle.forwardThrust === 22, 'single thruster');
const flyer = new Ship({shades: colors.white});
const engine = instanceOf(thrusterDualMd);
flyer.modules.push(engine); flyer.fit(engine);
for (const forward of [0, 1]) {
  for (const turn of [-1, 0, 1]) {
    flyer.fly(forward, turn);
    flyer.partsOf(engine.mount).forEach(part => {
      const side = part.thrusterNozzleSide;
      const expected = !turn || !side ? forward : turn === -side ? 1 : forward * 0.5;
      assert(part.active === expected, 'nozzle steering behavior');
    });
  }
}
flyer.fly(1, 1); flyer.update(0.1);
assert(Number.isFinite(flyer.x) && Number.isFinite(flyer.spin), 'flight remains finite');
flyer.fit(0, engine.mount);
assert(flyer.forwardThrust === 0 && flyer.cargoBay[0] === engine, 'removing engine removes thrust');
// Check actual launch motion, including the final 0.05-second full-power pulse:
// coast uses quarter thrust and speed cap, with half-size flames.
for (const type of [thrusterDualMd, thrusterDualXl, thrusterSingle, thrusterTriple]) {
  const departing = new Ship({shades: colors.white, x: 100000, y: 100000});
  const engine = instanceOf(type);
  departing.modules.push(engine); departing.fit(engine);
  launch(departing);
  let timer = 3;
  let expectedSpeed = 0;
  let expectedX = departing.x;
  const dt = 1 / 60;
  for (let frame = 0; frame < 240; frame++) {
    const launching = timer > 0;
    timer = Math.max(0, timer - dt);
    const fraction = timer > 0.05 && timer <= 2 ? 0.25 : 1;
    const forward = launching ? 1 : 0;
    const cap = 17 * type.forwardThrust * fraction;
    expectedSpeed += 220 * type.forwardThrust * fraction / departing.mass * forward * dt;
    if (expectedSpeed < 1) expectedSpeed = 0;
    expectedSpeed = expectedSpeed > cap ? Math.max(cap, expectedSpeed * 0.9) :
      expectedSpeed * Math.exp(-departing.drag * dt);
    expectedX += expectedSpeed * dt;
    departing.fly(flyOut(departing, dt) ? 1 : 0, 0);
    departing.update(dt);
    assert(Math.abs(departing.velocity.length() - expectedSpeed) < 1e-8,
      type.name + ': launch speed matches expected each frame');
    assert(Math.abs(departing.x - expectedX) < 1e-7,
      type.name + ': launch distance matches expected each frame');
    assert(departing.maxSpeed === cap, type.name + ': coast lowers actual speed cap');
    assert(departing.partsOf(engine.mount).every(part => part.active === forward * Math.sqrt(fraction)),
      type.name + ': launch nozzle activation');
  }
  launch(departing);
  timer = 3;
  let expectedSpin = departing.spin;
  for (let frame = 0; frame < 180; frame++) {
    timer = Math.max(0, timer - dt);
    const fraction = timer > 0.05 && timer <= 2 ? 0.25 : 1;
    const thrust = type.rotationalThrust * fraction;
    const target = departing.turnRate * thrust * fraction / 16;
    expectedSpin += Math.max(-thrust * dt, Math.min(thrust * dt, target - expectedSpin));
    departing.fly(flyOut(departing, dt) ? 1 : 0, 1);
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
    const craft = new Ship({ shades: colors.white });
    const engine = instanceOf(type);
    craft.modules.push(engine);
    craft.fit(engine);
    craft.ctx = ctx;
    craft.segments.forEach(segment => {
      segment.activationProgress = 1;
      segment.path = () => ({ kind: segment.module.forwardThrust ? 'flare' : 'hull' });
    });
    return craft;
  });
  const render = () => {
    draws.length = 0;
    for (const layer of [-1, -0.5, 0]) crafts.forEach(craft => craft.render([], layer));
    assert(saves === 0, 'renderer balances canvas state');
  };
  for (let order = 0; order < 2; order++) {
    render();
    const count = type.model.length * 2;
    assert(draws.slice(0, count).length === count && draws.slice(0, count).every(kind => kind === 'flare'),
      type.name + ': every flare precedes all glows');
    assert(draws.slice(count, count * 2).length === count && draws.slice(count, count * 2).every(kind => kind === 'glow'),
      type.name + ': glows share one layer across craft');
    assert(draws.slice(count * 2).every(kind => kind === 'hull'),
      'hulls remain above the glow layer');
    crafts.reverse();
  }
  crafts[0].segments.forEach(segment => segment.activationProgress = 0);
  crafts[1].engine.mount.health = 0;
  render();
  assert(!draws.includes('glow'), 'inactive and broken thrusters emit no glow');
  crafts.forEach(craft => craft.remove());
}

// Check the remaining reward names under production property mangling too.
assert(!colorUnlocked(colors.yellow), 'YELLOW starts locked');
playerShip.x = 50000;
playerShip.y = 0;
updatePlayer(0);
assert(colorUnlocked(colors.yellow), 'reaching the map edge unlocks YELLOW');
assert(playerShip.note === 'EDGE REACHED - YELLOW UNLOCKED', 'YELLOW reward message');

for (const [name, shades] of [['GREEN', colors.green]]) {
  assert(!colorUnlocked(shades), name + ' starts locked');
  unlockColor(name, '3 STATION VISITS');
  assert(colorUnlocked(shades), name + ' unlocks its palette');
  assert(playerShip.note === '3 STATION VISITS - GREEN UNLOCKED', name + ' reward message');
  playerShip.note = 'UNCHANGED';
  unlockColor(name);
  assert(playerShip.note === 'UNCHANGED', name + ' only announces once');
}
console.log('Inventory, menu, damage, repairs, scoop physics and flight tests passed');

`;

const bundle = await rolldown({
  input: 'docked-scenario.js',
  external: ['node:assert/strict'],
  plugins: [{
    name: 'docked-test-entry',
    resolveId: (id) => id === 'docked-scenario.js' ? '\0docked-scenario.js' : undefined,
    load: (id) => id === '\0docked-scenario.js' ? scenario : undefined,
    transform: (code, id) => id.endsWith('/src/ui/docked.js') ?
      `${code}\nexport { fitsOf };\nexport const selectionSnapshot = ship => [moduleOption, stage, ship && selectionOf(ship).actions, focused];` :
      undefined,
  }, viteJs13kPre()],
});
const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();

globalThis.z = { getContext: () => ({}) };
globalThis.location = { search: '' };
globalThis.Path2D = class {
  arc() {}
  closePath() {}
  lineTo() {}
  moveTo() {}
};

const { build } = viteConfig({ mode: 'fast', command: 'build' });
const compressed = await minify(output[0].code, build.terserOptions);

for (const code of [output[0].code, compressed.code]) {
  await import(`data:text/javascript,${encodeURIComponent(code)}`);
}
