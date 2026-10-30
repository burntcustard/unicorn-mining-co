import { readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';

const root = process.cwd();
const entryId = `${root}/src/__game_object_viewer_test.ts`;
const scenario = `
import assert from 'node:assert/strict';
import { Ship } from '${root}/src/client/objects/ship.ts';
import { CannonSm, Laser } from '${root}/src/client/objects/modules/index.ts';
import { colors } from '${root}/src/specs/colors.ts';

let frame;
let now = performance.now();
const noop = () => {};
const ctx = new Proxy({ createRadialGradient: () => ({ addColorStop: noop }) }, { get: (target, key) => target[key] ?? noop });
class Element {
  children = [];
  dataset = {};
  value = '';
  checked = false;
  clientWidth = 800;
  clientHeight = 600;
  get valueAsNumber() { return Number(this.value); }
  append(...children) { this.children.push(...children); children.forEach(child => { if (typeof child === 'object') child.parent = this; }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  replaceWith(child) {
    this.parent.children[this.parent.children.indexOf(this)] = child;
    child.parent = this.parent;
  }
  setAttribute() {}
  setPointerCapture() {}
  getContext() { return ctx; }
}
const elements = new Map();
Object.assign(globalThis, {
  window: {},
  document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    createElement: () => new Element(),
  },
  Option: class extends Element {
    constructor(text, value) { super(); this.textContent = text; this.value = value; }
  },
  Path2D: class { moveTo() {} lineTo() {} closePath() {} arc() {} },
  localStorage: { getItem: () => null, setItem() {} },
  devicePixelRatio: 1,
  requestAnimationFrame: callback => { frame = callback; return 1; },
  cancelAnimationFrame: noop,
  beams: 0,
});

const viewer = await import('${root}/src/tools/game-object-viewer/main.ts');
const ship = viewer.previewObject;
assert(ship instanceof Ship);
const moduleShades = ship.mounts.map(mount => mount.module?.shades);
const paint = elements.get('#hull-paint');
paint.value = 'cyan';
elements.get('aside').onchange({ target: paint });
assert.deepEqual(ship.shades, colors.cyan, 'the hull color control repaints the ship');
assert(ship.segments.filter(segment => segment.hull).every(segment => segment.shades === colors.cyan));
assert.deepEqual(ship.mounts.map(mount => mount.module?.shades), moduleShades, 'hull paint preserves fitted module colors');
const world = ship.world;
const gunMounts = () => ship.mounts.filter(mount => mount.module instanceof CannonSm || mount.module instanceof Laser);
const rows = () => elements.get('#modules').children;
const rowFor = mount => rows()[ship.mounts.indexOf(mount)];
const buttonFor = mount => rowFor(mount).children[2];
const activate = mount => {
  const checkbox = rowFor(mount).children[0].children[0];
  checkbox.checked = true;
  checkbox.onchange();
  ship.updateModules(10);
};
const press = button => button.onpointerdown({ button: 0, pointerId: 1 });
const shots = () => [...world.entities.values()].filter(entity => entity.kind === 'projectile');
const advance = () => { now += 50; frame(now); };
// Rendering is exercised separately below; repeated fire still runs the real frame loop.
ship.render = noop;
const [first, second] = gunMounts();
activate(first);
activate(second);
for (const mount of [first, second]) {
  world.entities.clear();
  mount.module.fireCooldown = 0;
  const button = buttonFor(mount);
  press(button);
  assert.equal(shots().length, 1, 'a fire button produces only its own projectile');
  assert.equal(shots()[0].position.y, mount.localPosition.y);
  button.onpointerup();
  world.entities.clear();
  for (let i = 0; i < 25; i++) advance();
  assert.equal(shots().length, 0, 'release stops repeated fire');
}

for (const mount of [first, second]) mount.module.fireCooldown = 0;
world.entities.clear();
press(buttonFor(first));
press(buttonFor(second));
assert.equal(shots().length, 2, 'two held buttons fire both modules');
buttonFor(first).onpointercancel();
world.entities.clear();
for (let i = 0; i < 25; i++) advance();
assert(shots().length > 0);
assert(shots().every(shot => shot.position.y === second.localPosition.y), 'releasing one button keeps the other firing');
window.onblur();
world.entities.clear();
for (let i = 0; i < 25; i++) advance();
assert.equal(shots().length, 0, 'losing window focus releases every button');

const firstButton = buttonFor(first);
first.module.fireCooldown = 0;
firstButton.onkeydown({ key: 'Enter', repeat: false, preventDefault: noop });
assert.equal(shots().length, 1, 'keyboard fire also selects its own mount');
firstButton.onkeyup({ key: 'Enter', preventDefault: noop });
first.module.fireCooldown = 0;
firstButton.onclick({ detail: 0 });
assert.equal(shots().length, 2, 'an accessible click fires once');
assert(!ship.moduleFiring(first.module));

// Replace the two cannons with identical lasers using the actual dropdown handlers.
elements.get('aside').onchange({ target: elements.get('#spec') });
const laserShip = viewer.previewObject;
assert.deepEqual(laserShip.shades, colors.cyan, 'hull color survives preview rebuilding');
const laserMounts = laserShip.mounts.filter(mount => mount.module instanceof CannonSm);
for (const mount of laserMounts) {
  const row = rows()[laserShip.mounts.indexOf(mount)];
  const select = row.children[1];
  select.value = 'laser';
  select.onchange();
  const checkbox = rows()[laserShip.mounts.indexOf(mount)].children[0].children[0];
  checkbox.checked = true;
  checkbox.onchange();
}
laserShip.updateModules(10);
assert(laserMounts.every(mount => mount.module instanceof Laser));
const laserButtons = laserMounts.map(mount => rows()[laserShip.mounts.indexOf(mount)].children[2]);
const visibleBeams = mount => {
  globalThis.beams = 0;
  mount.module.render({ craft: laserShip, segment: laserShip.segmentsAtMount(mount).at(-1) });
  return globalThis.beams;
};
press(laserButtons[1]);
assert.equal(visibleBeams(laserMounts[0]), 0, 'an idle duplicate laser has no beam');
assert.equal(visibleBeams(laserMounts[1]), 1, 'the laser beside the held button shows its beam');
press(laserButtons[0]);
laserButtons[1].onlostpointercapture();
assert.equal(visibleBeams(laserMounts[0]), 1);
assert.equal(visibleBeams(laserMounts[1]), 0);
window.onpagehide();
assert.equal(visibleBeams(laserMounts[0]), 0);
console.log('Preview buttons independently fire duplicate cannons and lasers, repeat while held, and release on focus loss');
`;

const bundle = await rolldown({
  input: entryId,
  external: ['node:assert/strict'],
  plugins: [
    {
      name: 'game-object-viewer-fixture',
      resolveId: (id) =>
        id === entryId
          ? id
          : id.endsWith('.css')
            ? '\0empty-style.ts'
            : undefined,
      load(id) {
        if (id === entryId) return scenario;

        if (id === '\0empty-style.ts') return '';

        if (id.endsWith('/src/client/audio/sound-loader.ts')) {
          return 'export const unlockAudio=()=>{};export const playSound=()=>{};';
        }

        if (id.endsWith('/src/client/effects/beam-effect.ts')) {
          return 'export const renderBeamEffect=()=>globalThis.beams++;';
        }

        if (id.endsWith('/src/tools/game-object-viewer/main.ts')) {
          return readFileSync(id, 'utf8').replaceAll(
            'import.meta.hot',
            '({data: {}, accept() {}, dispose() {}})',
          );
        }

        if (id.endsWith('/src/tools/game-object-viewer/catalog.ts')) {
          return (
            "import { courser } from '../../specs/ships/courser';\n" +
            readFileSync(id, 'utf8').replace(
              /const specs = import\.meta\.glob[\s\S]*?\n\);/,
              `const specs = { '../../specs/ships/courser.ts': { courser: {
                ...courser,
                hullSegments: courser.hullSegments.map(segment => ({
                  ...segment,
                  mounts: segment.mounts?.map(slot => slot.map(mount => ({
                    ...mount,
                    fits: mount.fits.includes('cannonSm') ? ['cannonSm', 'laser'] : mount.fits,
                  }))),
                })),
              } } };`,
            )
          );
        }
      },
    },
    buildPrePlugin(),
  ],
});

const { output } = await bundle.generate({
  format: 'esm',
  inlineDynamicImports: true,
});

await bundle.close();
await import(
  'data:text/javascript;base64,' +
    Buffer.from(output[0].code).toString('base64')
);
