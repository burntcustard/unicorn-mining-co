import './style.css';
import { game } from '../../client/game';
import { Craft } from '../../client/objects/craft';
import { type GameObject } from '../../client/objects/game-object';
import { renderingLayers } from '../../definitions/rendering-layers';
import * as Vec from '../../client/utilities/vector';
import { catalog, previewMounts, type ObjectType } from './catalog';
import { drawGrid } from './grid';

type ViewerState = {
  type: ObjectType;
  selected: Partial<Record<ObjectType, string>>;
  grid: boolean;
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
const definitionSelect =
  document.querySelector<HTMLSelectElement>('#definition')!;
const gridInput = document.querySelector<HTMLInputElement>('#grid')!;
const spinInput = document.querySelector<HTMLInputElement>('#spin')!;
const zoomInput = document.querySelector<HTMLInputElement>('#zoom')!;
const zoomValue = document.querySelector<HTMLOutputElement>('#zoom-value')!;
const moduleControls =
  document.querySelector<HTMLFieldSetElement>('#module-controls')!;
const modules = document.querySelector<HTMLDivElement>('#modules')!;
const source = document.querySelector<HTMLParagraphElement>('#source')!;
const coordinates = document.querySelector<HTMLOutputElement>('#coordinates')!;
let pointer: Vec.Value | undefined;
let frame: number;
let previousTime = performance.now();
export let previewObject: GameObject | undefined;

Object.assign(game, { canvas, ctx, physicsOn: false });

const persist = () => localStorage.setItem(storageKey, JSON.stringify(state));

const rebuild = () => {
  const definitions = catalog[state.type];
  const definition =
    definitions.find(({ key }) => key === state.selected[state.type]) ||
    definitions[0];

  definitionSelect.replaceChildren(
    ...definitions.map(({ key, label }) => new Option(label, key)),
  );
  definitionSelect.disabled = !definition;
  modules.replaceChildren();
  moduleControls.hidden = true;
  source.textContent = definition?.source || '';
  previewObject = undefined;

  if (!definition) return;

  state.selected[state.type] = definition.key;
  definitionSelect.value = definition.key;

  previewObject = definition.create();
  previewObject.physics = false;
  previewObject.rotation = state.rotation;

  if (previewObject instanceof Craft) {
    const craft = previewObject;
    const activation = (state.modules[definition.key] ||= {});
    const attachments = (state.attachments[definition.key] ||= {});
    const mounts = previewMounts(craft);

    moduleControls.hidden = !mounts.length;

    mounts.forEach(({ mount, key, label: text, options, defaultOption }) => {
      const attached =
        options.find(({ type }) => type === attachments[key]) || defaultOption;
      const module = new attached.Type();
      const row = document.createElement('div');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      const select = document.createElement('select');

      attachments[key] = attached.type;
      craft.fit(module, mount);

      checkbox.type = 'checkbox';
      checkbox.checked = activation[key] ?? false;
      checkbox.dataset.module = key;
      craft.segments
        .filter((segment) => segment.module === module)
        .forEach((segment) => (segment.active = Number(checkbox.checked)));
      label.append(checkbox, text);
      select.replaceChildren(
        ...options.map(({ type, label }) => new Option(label, type)),
      );
      select.value = attached.type;
      select.dataset.module = key;
      select.setAttribute('aria-label', `Module for ${text}`);
      row.append(label, select);
      modules.append(row);
    });
  }
};

const resize = () => {
  canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
};

const render = (now: number) => {
  const dt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));

  previousTime = now;

  if (state.spin) state.rotation = (state.rotation + dt * 0.4) % (Math.PI * 2);

  if (previewObject) {
    previewObject.rotation = state.rotation;

    if (previewObject instanceof Craft) {
      previewObject.updateModules(dt);
      previewObject.updateVisual(dt);
    }
  }

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

  if (pointer) {
    const point = ctx
      .getTransform()
      .inverse()
      .transformPoint(Vec.scale(pointer, devicePixelRatio));

    coordinates.value = `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`;
  }

  ctx.restore();

  if (previewObject instanceof Craft) {
    for (const zIndex of Object.values(renderingLayers)) {
      previewObject.render({ zIndex });
    }
  } else previewObject?.render();

  frame = requestAnimationFrame(render);
};

typeSelect.value = state.type;
gridInput.checked = state.grid;
spinInput.checked = state.spin;
zoomInput.value = String(state.zoom);
state.zoom = zoomInput.valueAsNumber;
zoomValue.value = `${state.zoom.toFixed(2)}×`;

controls.onchange = ({ target }) => {
  if (target === typeSelect) {
    state.type = typeSelect.value as ObjectType;
    rebuild();
  } else if (target === definitionSelect) {
    state.selected[state.type] = definitionSelect.value;
    rebuild();
  } else if (target === gridInput) state.grid = gridInput.checked;
  else if (target === spinInput) state.spin = spinInput.checked;
  else if (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement) &&
    target.dataset.module &&
    previewObject instanceof Craft
  ) {
    const { module: key } = target.dataset;
    const { mount, options } = previewMounts(previewObject).find(
      (mount) => mount.key === key,
    )!;

    if (target instanceof HTMLSelectElement) {
      const { Type } = options.find(({ type }) => type === target.value)!;

      state.attachments[definitionSelect.value][key] = target.value;
      previewObject.fit(new Type(), mount);
      previewObject.cargoContents.length = 0;
    } else state.modules[definitionSelect.value][key] = target.checked;

    previewObject.segments
      .filter((segment) => segment.mount === mount)
      .forEach(
        (segment) =>
          (segment.active = Number(
            state.modules[definitionSelect.value][key] ?? false,
          )),
      );
  }

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

canvas.onpointermove = (event) => {
  pointer = Vec.create(event.offsetX, event.offsetY);
};

canvas.onpointerleave = () => {
  pointer = undefined;
  coordinates.value = 'Move the pointer over the preview';
};

window.onpagehide = persist;
window.onresize = resize;
resize();
rebuild();
frame = requestAnimationFrame(render);

import.meta.hot.accept();

import.meta.hot.dispose((data) => {
  data.state = state;
  persist();
  cancelAnimationFrame(frame);
});
