import '../style.css';
import { game } from '../../client/game';
import { Craft } from '../../client/objects/craft';
import { Ship } from '../../client/objects/ship';
import { Item } from '../../client/objects/item';
import { moduleControls as gameModuleControls } from '../../client/objects/control-ship';
import { moduleBinding } from '../../client/input/keybindings';
import { createWorld } from '../../client/simulation/world';
import { autogunAmmunition } from '../../specs/items';
import { Laser } from '../../client/objects/modules/laser';
import { Weapon } from '../../client/objects/modules/weapon';
import { type GameObject } from '../../client/objects/game-object';
import { renderingLayers } from '../../specs/rendering-layers';
import { simulationStep } from '../../specs/simulation';
import * as Vec from '../../client/utilities/vector';
import { catalog, previewMounts, type ObjectType } from './catalog';
import { drawGrid } from './grid';
import {
  addEffect,
  effects,
  renderEffects,
  updateEffects,
} from '../../client/effects/effect';
import { plasmaExplosion } from '../../specs/effects/plasma-explosion';
import { autogunExplosion } from '../../specs/effects/autogun-explosion';

type ViewerState = {
  type: ObjectType;
  selected: Partial<Record<ObjectType, string>>;
  grid: boolean;
  mountPoints: boolean;
  spin: boolean;
  rotation: number;
  zoom: number;
  modules: Record<string, Record<string, boolean>>;
  attachments: Record<string, Record<string, string>>;
};

const storageKey = 'unicorn-game-object-viewer';
const restored: Partial<ViewerState> =
  import.meta.hot.data.state ||
  JSON.parse(localStorage.getItem(storageKey) || 'null');

export const state: ViewerState = {
  type: 'ship',
  selected: {},
  grid: true,
  mountPoints: true,
  spin: false,
  rotation: 0,
  zoom: 2,
  modules: {},
  attachments: {},
  ...restored,
};

const controls = document.querySelector('aside')!;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d')!;
const typeSelect = document.querySelector<HTMLSelectElement>('#object-type')!;
const specSelect = document.querySelector<HTMLSelectElement>('#spec')!;
const gridInput = document.querySelector<HTMLInputElement>('#grid')!;
const mountPointsInput =
  document.querySelector<HTMLInputElement>('#mount-points')!;
const spinInput = document.querySelector<HTMLInputElement>('#spin')!;
const zoomInput = document.querySelector<HTMLInputElement>('#zoom')!;
const zoomValue = document.querySelector<HTMLOutputElement>('#zoom-value')!;
const moduleControls =
  document.querySelector<HTMLFieldSetElement>('#module-controls')!;
const modules = document.querySelector<HTMLDivElement>('#modules')!;
const source = document.querySelector<HTMLParagraphElement>('#source')!;
const coordinates = document.querySelector<HTMLOutputElement>('#coordinates')!;
const slowEffect = document.querySelector<HTMLInputElement>('#slow-effect')!;
let pointer: Vec.Value | undefined;
let frame: number;
let previousTime = performance.now();
export let previewObject: GameObject | undefined;

Object.assign(game, { canvas, ctx, physicsOn: false });

const persist = () => localStorage.setItem(storageKey, JSON.stringify(state));
const world = createWorld();
const releases = new Set<() => void>();
const stopFiring = () => releases.forEach((release) => release());

const createMountControls = ({
  craft,
  mount,
  key,
  label: text,
  options,
  defaultOption,
}: ReturnType<typeof previewMounts>[number] & { craft: Craft }) => {
  const activation = state.modules[specSelect.value];
  const attachments = state.attachments[specSelect.value];
  const attached =
    attachments[key] === ''
      ? undefined
      : options.find(({ type }) => type === attachments[key]) || defaultOption;
  const module = attached ? new attached.Type() : 0;
  const control = gameModuleControls.find(({ Type }) => module instanceof Type);
  const mode =
    module instanceof Weapon || module instanceof Laser
      ? 'hold'
      : control
        ? moduleBinding(control.input).mode
        : 'toggle';
  const firing = mode !== 'toggle';
  const row = document.createElement('div');
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  const select = document.createElement('select');
  const button = document.createElement('button');

  const setActive = (active: boolean) =>
    craft.segmentsAtMount(mount).forEach((segment) => {
      segment.active = Number(active);
    });

  const release = () => {
    if (module instanceof Weapon || module instanceof Laser) {
      craft.firing = false;
    } else setActive(false);

    releases.delete(release);
  };

  const fire = () => {
    craft.firing = true;
    Ship.prototype.fireWeapons.call(craft, 0);
    craft.updateVisual(0);

    if (mode === 'hold') releases.add(release);
    else release();
  };

  attachments[key] = attached?.type ?? '';
  craft.fit(module, mount);

  // A stationary preview must not accumulate recoil between shots.
  if (module instanceof Weapon || module instanceof Laser) module.recoil = 0;

  checkbox.type = 'checkbox';
  checkbox.hidden =
    firing && !(module instanceof Weapon || module instanceof Laser);
  checkbox.checked = !!module && (activation[key] ?? false);
  checkbox.disabled = !module;
  checkbox.dataset.module = key;
  setActive(checkbox.checked);
  const { x, y } = mount.localPosition;
  const mountLabel = `${text} (${x}, ${y})`;

  label.append(checkbox, mountLabel);
  select.replaceChildren(
    new Option('Empty', ''),
    ...options.map(({ type, label }) => new Option(label, type)),
  );
  select.value = attached?.type ?? '';
  select.dataset.module = key;
  select.setAttribute('aria-label', `Module for ${mountLabel}`);
  button.type = 'button';
  button.textContent = 'Fire';
  button.hidden = !firing;
  button.setAttribute('aria-label', `Fire ${attached?.label} at ${mountLabel}`);

  checkbox.onchange = () => {
    activation[key] = checkbox.checked;
    setActive(checkbox.checked);
    persist();
  };

  select.onchange = () => {
    release();
    attachments[key] = select.value;

    row.replaceWith(
      createMountControls({
        craft,
        mount,
        key,
        label: text,
        options,
        defaultOption,
      }),
    );

    craft.cargoContents = craft.cargoContents.filter(
      (item) => item instanceof Item,
    );
    persist();
  };

  button.onpointerdown = (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    fire();
  };

  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
  button.onblur = release;

  button.onkeydown = (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();

    if (!event.repeat) fire();
  };

  button.onkeyup = (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    release();
  };

  button.onclick = (event) => {
    if (event.detail) return;
    fire();
    release();
  };

  row.append(label, select, button);
  return row;
};

const rebuild = () => {
  stopFiring();
  effects.length = 0;
  world.entities.clear();
  world.players.clear();
  const specs = catalog[state.type];
  const spec =
    specs.find(({ key }) => key === state.selected[state.type]) || specs[0];

  specSelect.replaceChildren(
    ...specs.map(({ key, label }) => new Option(label, key)),
  );
  specSelect.disabled = !spec;
  modules.replaceChildren();
  moduleControls.hidden = true;
  source.textContent = spec?.source || '';
  previewObject = undefined;

  if (!spec) return;

  state.selected[state.type] = spec.key;
  specSelect.value = spec.key;

  previewObject = spec.create();
  previewObject.physics = false;
  previewObject.rotation = state.rotation;

  if (previewObject instanceof Craft) {
    const craft = previewObject;

    craft.world = world;
    craft.playerId = 1;
    world.players.set(1, { id: 1, shipId: craft.id });
    craft.cargoContents.push(new Item(autogunAmmunition, { rounds: Infinity }));
    state.modules[spec.key] ||= {};
    state.attachments[spec.key] ||= {};
    const mounts = previewMounts(craft);

    moduleControls.hidden = !mounts.length;
    modules.append(
      ...mounts.map((mount) => createMountControls({ craft, ...mount })),
    );
  }
};

const resize = () => {
  canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
};

const render = (now: number) => {
  const dt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));

  previousTime = now;
  world.tick += dt / simulationStep;

  if (state.spin) state.rotation = (state.rotation + dt * 0.4) % (Math.PI * 2);

  if (previewObject) {
    previewObject.rotation = state.rotation;

    if (previewObject instanceof Craft) {
      previewObject.updateModules(dt);
      Ship.prototype.fireWeapons.call(previewObject, dt);
      previewObject.updateVisual(dt);
    }
  }

  world.entities.forEach((projectile) => projectile.update(dt));
  updateEffects(dt * (slowEffect.checked ? 250 : 1000));

  game.scale = state.zoom * devicePixelRatio;
  game.width = canvas.width / game.scale;
  game.height = canvas.height / game.scale;
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(
    game.scale,
    0,
    0,
    game.scale,
    canvas.width / 2,
    canvas.height / 2,
  );
  ctx.save();
  ctx.rotate(state.rotation);

  if (state.grid) {
    drawGrid({
      ctx,
      reach: Math.hypot(game.width, game.height) / 2,
      scale: game.scale,
    });
  }

  ctx.restore();

  if (previewObject instanceof Craft) {
    for (const zIndex of Object.values(renderingLayers)) {
      previewObject.render({ zIndex });
    }

    world.entities.forEach((projectile) => projectile.render());

    if (state.mountPoints) {
      ctx.save();
      ctx.translate(previewObject.position.x, previewObject.position.y);
      ctx.rotate(previewObject.rotation);
      ctx.fillStyle = '#f00';

      previewObject.mounts
        .filter(
          ({ module }) =>
            module &&
            (module.collectsCargo ||
              module instanceof Weapon ||
              module instanceof Laser),
        )
        .forEach(({ localPosition: { x, y } }) => {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        });

      ctx.restore();
    }
  } else previewObject?.render();

  renderEffects({ ctx });

  if (pointer) {
    ctx.save();
    ctx.rotate(state.rotation);
    const point = ctx
      .getTransform()
      .inverse()
      .transformPoint(Vec.scale(pointer, devicePixelRatio));

    coordinates.value = `x: ${Math.round(point.x)} / y: ${Math.round(point.y)}`;
    coordinates.hidden = false;

    const { offsetWidth: width, offsetHeight: height } = coordinates;
    const right = pointer.x >= canvas.clientWidth / 2;
    const bottom = pointer.y >= canvas.clientHeight / 2;

    coordinates.style.left = `${Math.max(
      0,
      Math.min(
        canvas.clientWidth - width,
        pointer.x + (right ? 12 : -12 - width),
      ),
    )}px`;

    coordinates.style.top = `${Math.max(
      0,
      Math.min(
        canvas.clientHeight - height,
        pointer.y + (bottom ? 12 : -12 - height),
      ),
    )}px`;

    ctx.fillStyle = '#1b4';
    ctx.beginPath();
    ctx.arc(
      Math.round(point.x),
      Math.round(point.y),
      4 / state.zoom,
      0,
      Math.PI * 2,
    );

    ctx.fill();
    ctx.restore();
  }

  frame = requestAnimationFrame(render);
};

typeSelect.value = state.type;
gridInput.checked = state.grid;
mountPointsInput.checked = state.mountPoints;
spinInput.checked = state.spin;
zoomInput.value = String(state.zoom);
state.zoom = zoomInput.valueAsNumber;
zoomValue.value = `${state.zoom.toFixed(2)}×`;

controls.onchange = ({ target }) => {
  if (target === typeSelect) {
    state.type = typeSelect.value as ObjectType;
    rebuild();
  } else if (target === specSelect) {
    state.selected[state.type] = specSelect.value;
    rebuild();
  } else if (target === gridInput) state.grid = gridInput.checked;
  else if (target === mountPointsInput) {
    state.mountPoints = mountPointsInput.checked;
  } else if (target === spinInput) state.spin = spinInput.checked;

  persist();
};

zoomInput.oninput = () => {
  state.zoom = zoomInput.valueAsNumber;
  zoomValue.value = `${state.zoom.toFixed(2)}×`;
  persist();
};

document.querySelector<HTMLButtonElement>('#reset-rotation')!.onclick = () => {
  state.rotation = 0;
  persist();
};

document.querySelector<HTMLButtonElement>('#replay-effect')!.onclick = () => {
  effects.length = 0;
  addEffect({ position: Vec.create(), effect: plasmaExplosion });
};

document.querySelector<HTMLButtonElement>('#replay-autogun-effect')!.onclick =
  () => {
    effects.length = 0;
    addEffect({ position: Vec.create(), effect: autogunExplosion });
  };

canvas.onpointermove = (event) => {
  pointer = Vec.create(event.offsetX, event.offsetY);
};

canvas.onpointerleave = () => {
  pointer = undefined;
  coordinates.hidden = true;
};

window.onblur = stopFiring;

window.onpagehide = () => {
  stopFiring();
  persist();
};

window.onresize = resize;
resize();
rebuild();
frame = requestAnimationFrame(render);

import.meta.hot.accept();

import.meta.hot.dispose((data) => {
  stopFiring();
  effects.length = 0;
  data.state = state;
  persist();
  cancelAnimationFrame(frame);
});
