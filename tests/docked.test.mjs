/* global process */
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import { viteJs13kPre } from '../plugins/vite-js13k.js';

// Keep the assertions in the bundle so production property mangling applies
// consistently to both the game objects and the checks that inspect them.
const scenario = `
import assert from 'node:assert/strict';
import { Ship, damage } from '${process.cwd()}/src/ship.js';
import { instanceOf, cargoScoop, thrusterDualMd } from '${process.cwd()}/src/modules/index.js';
import { roomFor, playerShip } from '${process.cwd()}/src/player.js';
import { game } from '${process.cwd()}/src/game.js';
import { colors } from '${process.cwd()}/src/colors.js';
import {
  back, confirmSelection, moveSelection, moveSubSelection,
  fitsOf, selectionSnapshot,
} from '${process.cwd()}/src/ui/docked.js';

const ship = new Ship({ shades: colors.white, credits: 10000 });
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
move(1); moveSubSelection(-100, ship); confirm();
assert(bought.shades === colors.red && first.shades === colors.red, 'paint purchased instance');
moveSubSelection(1, ship); confirm();
assert(bought.shades === colors.orange && first.shades === colors.red, 'independent paint');
move(-1); mount.health = 1; confirm();
assert(mount.health === cargoScoop.health, 'module repair');
confirm();
assert(!bought.mount && ship.cargoBay[0] === bought, 'removed instance becomes cargo');

// Capacity counts loose modules and physical cargo, excluding fitted modules.
const ore = { name: 'ORE', price: 7 };
const gem = { name: 'GEM', price: 11 };
ship.cargo = Array.from({length: 11}, () => ({ item: ore }));
assert(!roomFor(ship), 'loose module fills twelfth cargo space');
ship.fit(bought, mount);
assert(roomFor(ship), 'equipping frees cargo space');
ship.fit(0, mount);
assert(!roomFor(ship), 'removing consumes cargo space');

// Full cargo blocks a purchase without altering inventory or credits.
back(ship); back(ship); move(-100); move(3); confirm(); confirm();
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
confirm(); confirm();
assert(!ship.cargo.length && ship.credits === beforeSale + cargoScoop.price + 25, 'last cargo sale');
assert(selectionSnapshot()[1] === 1, 'empty cargo returns to list');

// Rebuild hulls without duplicating mounts or resurrecting destroyed inventory.
confirm(); move(1); confirm();
lowerMount.hull.health = 1;
confirm();
assert(lowerMount.hull.health === lowerMount.hull.module.health, 'hull repair');
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
assert(playerShip.modules.length === 6 && !playerShip.cargoBay.length, 'starter inventory');
assert(new Set(playerShip.modules).size === 6, 'starter modules are distinct instances');
assert(playerShip.modules.every(module => module.mount.module === module), 'starter mount links');
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
      `${code}\nexport { fitsOf };\nexport const selectionSnapshot = () => [moduleOption, stage];` :
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

const compressed = await minify(output[0].code, {
  module: true,
  toplevel: true,
  compress: {
    passes: 4,
    unsafe: true,
    unsafe_arrows: true,
    unsafe_comps: true,
    unsafe_math: true,
    pure_getters: true,
  },
  mangle: { properties: { reserved: ['Up', 'ht', 'ft'] } },
});

for (const code of [output[0].code, compressed.code]) {
  await import(`data:text/javascript,${encodeURIComponent(code)}`);
}
