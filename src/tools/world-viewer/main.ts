import './style.css';
import * as Vec from '../../client/utilities/vector';
import {
  generateSectorMap,
  type Sector,
} from '../../client/simulation/sector-generation';
import { sectorGeneration, startingSectorId } from '../../specs/sectors';
import { type Scene } from './scene';

type Camera = { position: Vec.Value; span: number };

type Layer =
  | 'fields'
  | 'asteroids'
  | 'stations'
  | 'wrecks'
  | 'gates'
  | 'wormholes'
  | 'density'
  | 'grid';

type ViewerState = {
  worldSeed: number;
  sectorId: string;
  view: 'sector' | 'world';
  disabled: boolean;
  layers: Record<Layer, boolean>;
  cameras: Record<'sector' | 'world', Camera>;
};

const storageKey = 'unicorn-world-viewer';

const restore = (): Partial<ViewerState> => {
  try {
    return (
      import.meta.hot?.data.state ||
      JSON.parse(localStorage.getItem(storageKey) || '{}')
    );
  } catch {
    return {};
  }
};

const saved = restore();

const state: ViewerState = {
  worldSeed: 25,
  sectorId: startingSectorId,
  view: 'sector',
  disabled: false,
  ...saved,
  layers: {
    fields: true,
    asteroids: true,
    stations: true,
    wrecks: true,
    gates: true,
    wormholes: true,
    density: true,
    grid: true,
    ...saved.layers,
  },
  cameras: {
    sector: { position: Vec.create(), span: 0 },
    world: { position: Vec.create(), span: 2400 },
    ...saved.cameras,
  },
};

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d')!;
const seedInput = document.querySelector<HTMLInputElement>('#seed')!;
const sectorInput = document.querySelector<HTMLSelectElement>('#sector')!;
const viewInput = document.querySelector<HTMLSelectElement>('#view')!;
const disabledInput = document.querySelector<HTMLInputElement>('#disabled')!;
const status = document.querySelector('#status')!;
const parameters = document.querySelector('#parameters')!;
const title = document.querySelector('#title')!;
const scale = document.querySelector('#scale')!;
const coordinates = document.querySelector<HTMLOutputElement>('#coordinates')!;
const events = new AbortController();
const listen = { signal: events.signal };
let map = generateSectorMap({ worldSeed: state.worldSeed });
let scene: Scene | undefined;
let worker: Worker | undefined;
let busy = false;
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
let frame = 0;
let width = 1;
let height = 1;
let pointer: Vec.Value | undefined;

let drag:
  | { pointer: Vec.Value; position: Vec.Value; moved: boolean }
  | undefined;

const sector = () => map.sectors.find(({ id }) => id === state.sectorId)!;
const camera = () => state.cameras[state.view];
const persist = () => localStorage.setItem(storageKey, JSON.stringify(state));
const format = (number: number) => Math.round(number).toLocaleString('en-US');
const pixelsPerUnit = () => width / camera().span;
const screen = (position: Vec.Value) =>
  Vec.create(
    (position.x - camera().position.x) * pixelsPerUnit() + width / 2,
    (position.y - camera().position.y) * pixelsPerUnit() + height / 2,
  );
const location = (position: Vec.Value) =>
  Vec.create(
    (position.x - width / 2) / pixelsPerUnit() + camera().position.x,
    (position.y - height / 2) / pixelsPerUnit() + camera().position.y,
  );
const visibleSectors = () =>
  map.sectors.filter(({ id }) => state.disabled || map.enabled.includes(id));
const hoveredSector = () =>
  pointer &&
  visibleSectors().find(
    (entry) => Vec.distance(screen(entry.mapPosition), pointer) < 12,
  );

const circle = (
  position: Vec.Value,
  radius: number,
  color: string,
  fill = true,
) => {
  const at = screen(position);

  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle = color;

  if (fill) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
};

const line = (from: Vec.Value, to: Vec.Value, color: string) => {
  const a = screen(from);
  const b = screen(to);

  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

const text = (
  position: Vec.Value,
  label: string,
  color = '#eef',
  offset = 12,
) => {
  const at = screen(position);

  ctx.fillStyle = color;
  ctx.fillText(label, at.x + offset, at.y - offset);
};

const fieldColors: Record<number, string> = {
  1: '#c86cff',
  2: '#ffd54a',
  4: '#8fb7ba',
};

const connections = [
  {
    layer: 'gates',
    links: 'links',
    sites: 'gateSites',
    label: 'Jump Gate',
    color: '#45d6c5',
  },
  {
    layer: 'wormholes',
    links: 'wormholeLinks',
    sites: 'wormholeSites',
    label: 'Wormhole',
    color: '#b89aff',
  },
] as const;

const drawGrid = () => {
  const target = 110 / pixelsPerUnit();
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step =
    [1, 2, 5, 10].find((value) => value * magnitude >= target)! * magnitude;
  const from = location(Vec.create());
  const to = location(Vec.create(width, height));

  ctx.font = '10px ui-monospace, monospace';

  for (let x = Math.ceil(from.x / step) * step; x < to.x; x += step) {
    line(
      Vec.create(x, from.y),
      Vec.create(x, to.y),
      x === 0 ? '#465168' : '#242c3b',
    );
    ctx.fillStyle = '#7f8a9e';
    ctx.fillText(format(x), screen(Vec.create(x, 0)).x + 4, height - 12);
  }

  for (let y = Math.ceil(from.y / step) * step; y < to.y; y += step) {
    line(
      Vec.create(from.x, y),
      Vec.create(to.x, y),
      y === 0 ? '#465168' : '#242c3b',
    );
    ctx.fillStyle = '#7f8a9e';
    ctx.fillText(format(y), 8, screen(Vec.create(0, y)).y - 4);
  }
};

const drawWorld = () => {
  const visible = new Map(visibleSectors().map((entry) => [entry.id, entry]));

  for (const connection of connections) {
    if (!state.layers[connection.layer]) continue;
    ctx.setLineDash(connection.layer === 'wormholes' ? [4, 6] : []);

    for (const link of map[connection.links]) {
      const a = visible.get(link.sectors[0]);
      const b = visible.get(link.sectors[1]);

      if (!a || !b) continue;
      ctx.globalAlpha =
        map.enabled.includes(a.id) && map.enabled.includes(b.id) ? 0.6 : 0.2;
      line(a.mapPosition, b.mapPosition, connection.color);
    }
  }

  ctx.setLineDash([]);

  const hovered = hoveredSector();

  const labels: { left: number; right: number; top: number; bottom: number }[] =
    [];

  const ordered = [...visible.values()].sort((a, b) => {
    const priority = (entry: Sector) =>
      entry === hovered || entry.id === state.sectorId
        ? 0
        : map.enabled.includes(entry.id)
          ? 1
          : 2;

    return priority(a) - priority(b);
  });

  for (const entry of ordered) {
    ctx.globalAlpha = map.enabled.includes(entry.id) ? 1 : 0.45;
    circle(
      entry.mapPosition,
      entry.id === state.sectorId || hovered === entry ? 7 : 4,
      entry.id === state.sectorId ? '#ffd54a' : '#45d6c5',
    );
    const at = screen(entry.mapPosition);
    const labelWidth = ctx.measureText(entry.name).width;
    const offsets = [
      Vec.create(9, -9),
      Vec.create(9, 18),
      Vec.create(-labelWidth - 9, -9),
      Vec.create(-labelWidth - 9, 18),
    ];

    for (const offset of offsets) {
      const bounds = {
        left: at.x + offset.x - 3,
        right: at.x + offset.x + labelWidth + 3,
        top: at.y + offset.y - 13,
        bottom: at.y + offset.y + 3,
      };

      if (
        bounds.left < 0 ||
        bounds.right > width ||
        bounds.top < 40 ||
        bounds.bottom > height - 30 ||
        labels.some(
          (other) =>
            bounds.left < other.right &&
            bounds.right > other.left &&
            bounds.top < other.bottom &&
            bounds.bottom > other.top,
        )
      ) {
        continue;
      }

      labels.push(bounds);
      ctx.fillStyle = '#eef';
      ctx.fillText(entry.name, at.x + offset.x, at.y + offset.y);
      break;
    }
  }

  ctx.globalAlpha = 1;
};

const drawDensity = (entry: Sector) => {
  const origin = screen(Vec.create());

  const contours = [
    { radius: sectorGeneration.density[0].scale, color: '#8fb7ba' },
    { radius: sectorGeneration.density[0].scale * 2, color: '#8fb7ba' },
    {
      radius:
        sectorGeneration.density[1].scale * sectorGeneration.density[1].cutoff,
      color: '#fff',
    },
    { radius: sectorGeneration.density[2].scale, color: '#ff9966' },
  ];

  ctx.setLineDash([5, 6]);
  ctx.globalAlpha = 0.45;

  for (const contour of contours) {
    ctx.beginPath();
    ctx.strokeStyle = contour.color;
    ctx.ellipse(
      origin.x,
      origin.y,
      entry.radiusX * contour.radius * pixelsPerUnit(),
      entry.radiusY * contour.radius * pixelsPerUnit(),
      entry.rotation,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
};

const drawSector = () => {
  const entry = sector();

  if (state.layers.fields) {
    for (const field of scene?.fields || []) {
      ctx.globalAlpha = 0.12;
      circle(
        field.position,
        field.radius * pixelsPerUnit(),
        fieldColors[field.resource],
      );
      ctx.globalAlpha = 0.6;
      circle(
        field.position,
        field.radius * pixelsPerUnit(),
        fieldColors[field.resource],
        false,
      );
    }

    ctx.globalAlpha = 1;
  }

  if (state.layers.density) drawDensity(entry);

  if (state.layers.asteroids) {
    for (const asteroid of scene?.asteroids || []) {
      circle(
        asteroid.position,
        Math.max(0.7, asteroid.radius * pixelsPerUnit()),
        fieldColors[asteroid.resource],
      );
    }
  }

  if (state.layers.stations) {
    for (const station of scene?.stations || []) {
      const at = screen(station.position);
      const radius = Math.max(3, station.radius * pixelsPerUnit());

      ctx.fillStyle = '#fff';
      ctx.fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2);

      if (camera().span < 50000) {
        text(station.position, station.definitionId, '#fff', radius + 8);
      }
    }
  }

  if (state.layers.wrecks) {
    for (const wreck of scene?.wrecks || []) {
      circle(
        wreck.position,
        Math.max(2, wreck.radius * pixelsPerUnit()),
        '#ff9966',
      );
    }
  }

  for (const connection of connections) {
    if (!state.layers[connection.layer]) continue;

    for (const [index, site] of entry[connection.sites].entries()) {
      const link = map[connection.links].find((link) => {
        const side = link.sectors.indexOf(entry.id);

        return side >= 0 && link.sites[side] === index;
      });

      const destination =
        link &&
        map.sectors.find(
          ({ id }) => id === link.sectors[1 - link.sectors.indexOf(entry.id)],
        );
      const enabled =
        destination &&
        map.enabled.includes(entry.id) &&
        map.enabled.includes(destination.id);

      if (!destination && !state.disabled) continue;

      ctx.globalAlpha = connection.layer === 'wormholes' || enabled ? 1 : 0.4;
      ctx.setLineDash(connection.layer === 'wormholes' ? [3, 3] : []);
      circle(
        site.position,
        Math.max(5, site.radius * pixelsPerUnit()),
        connection.color,
        false,
      );
      ctx.setLineDash([]);
      text(
        site.position,
        `${connection.label} · ${destination?.name || 'reserved site'}`,
        connection.color,
      );

      if (camera().span < 100000) {
        line(site.position, site.arrival, connection.color);
        circle(site.arrival, 3, connection.color, false);
      }
    }

    ctx.globalAlpha = 1;
  }
};

const draw = () => {
  frame = 0;
  const dpr = Math.min(devicePixelRatio, 2);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (state.layers.grid) drawGrid();
  ctx.font = '12px system-ui';

  if (state.view === 'world') {
    drawWorld();
  } else {
    drawSector();
  }

  title.textContent =
    state.view === 'world' ? "Jupiter's L5 region" : sector().name;
  scale.textContent =
    state.view === 'world'
      ? 'Map positions are illustrative'
      : `${format(camera().span)} units across`;
  coordinates.hidden = !pointer;

  if (pointer) {
    const at = location(pointer);

    coordinates.textContent =
      state.view === 'world'
        ? hoveredSector()?.name || 'Click a sector to inspect it'
        : `${sector().name} ${format(at.x)} / ${format(at.y)}`;
  }
};

const redraw = () => {
  if (!frame) frame = requestAnimationFrame(draw);
};

const requestScene = () => {
  clearTimeout(timer);
  const requestRevision = ++revision;

  if (busy || state.view === 'world') {
    worker?.terminate();
    worker = undefined;
    busy = false;
  }

  if (state.view === 'world') {
    status.textContent = `${map.enabled.length} initially enabled · ${map.sectors.length} total sectors · ${map.links.length} Jump Gate links · ${map.wormholeLinks.length} wormhole links`;
    return;
  }

  status.textContent = 'Generating visible features…';

  timer = setTimeout(() => {
    worker ||= new Worker(new URL('./generation-worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({
      data,
    }: MessageEvent<{ scene?: Scene; error?: string; duration: number }>) => {
      if (requestRevision !== revision) return;
      busy = false;

      if (data.error) {
        status.textContent = data.error;
        return;
      }

      scene = data.scene!;
      status.textContent = scene.overview
        ? `${scene.fields.length} fields · ${scene.stations.length} stations · ${scene.wrecks.length} wrecks · ${Math.round(data.duration)} ms. ${scene.detailed ? `${scene.asteroids.length} asteroids.` : 'Zoom in for individual asteroids.'}`
        : 'Zoom in to sample individual features.';
      redraw();
    };

    worker.onerror = (event) => {
      busy = false;
      status.textContent = `Generation failed: ${event.message}`;
    };

    busy = true;

    worker.postMessage({
      worldSeed: state.worldSeed,
      sector: sector(),
      from: location(Vec.create()),
      to: location(Vec.create(width, height)),
      detail: state.layers.asteroids,
    });
  }, 100);
};

const fit = () => {
  const current = camera();

  Vec.set(current.position, Vec.create());
  current.span =
    state.view === 'world'
      ? Math.max(
          sectorGeneration.mapRadiusX * 2.4,
          (sectorGeneration.mapRadiusY * 2.4 * width) / height,
        )
      : Math.max(
          sector().radiusX * 2.8,
          (sector().radiusY * 2.8 * width) / height,
        );
};

const changed = () => {
  persist();
  redraw();
  requestScene();
};

const updateControls = () => {
  if (!map.sectors.some(({ id }) => id === state.sectorId)) {
    state.sectorId = startingSectorId;
  }

  seedInput.value = String(state.worldSeed);
  viewInput.value = state.view;
  disabledInput.checked = state.disabled;
  sectorInput.replaceChildren(
    ...map.sectors.map(({ id, name }) => new Option(name, id)),
  );
  sectorInput.value = state.sectorId;
  const entry = sector();

  parameters.textContent = `Seed ${entry.seed} · radii ${format(entry.radiusX)} × ${format(entry.radiusY)} · ${Math.round((entry.rotation * 180) / Math.PI)}° · ${((entry.radiusX * 2) / sectorGeneration.cruiseSpeed / 60).toFixed(1)} min across · ${map.links.filter((link) => link.sectors.includes(entry.id)).length} Jump Gates · ${map.wormholeLinks.filter((link) => link.sectors.includes(entry.id)).length} wormholes (including future connections)`;
};

const selectSector = (id: string) => {
  state.sectorId = id;
  state.view = 'sector';
  scene = undefined;
  updateControls();
  fit();
  changed();
};

seedInput.addEventListener(
  'change',
  () => {
    if (!seedInput.checkValidity()) {
      seedInput.reportValidity();
      return;
    }

    state.worldSeed = seedInput.valueAsNumber;
    map = generateSectorMap({ worldSeed: state.worldSeed });
    scene = undefined;
    updateControls();
    fit();
    changed();
  },
  listen,
);

sectorInput.addEventListener(
  'change',
  () => {
    selectSector(sectorInput.value);
  },
  listen,
);

viewInput.addEventListener(
  'change',
  () => {
    state.view = viewInput.value as ViewerState['view'];

    if (!camera().span) fit();
    changed();
  },
  listen,
);

disabledInput.addEventListener(
  'change',
  () => {
    state.disabled = disabledInput.checked;
    changed();
  },
  listen,
);

document.querySelector('#fit')!.addEventListener(
  'click',
  () => {
    fit();
    changed();
  },
  listen,
);

document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
  const layer = input.dataset.layer as Layer;

  input.checked = state.layers[layer];

  input.addEventListener(
    'change',
    () => {
      state.layers[layer] = input.checked;
      persist();
      redraw();

      if (layer === 'asteroids') requestScene();
    },
    listen,
  );
});

const pointerPosition = (event: PointerEvent | WheelEvent) => {
  const bounds = canvas.getBoundingClientRect();

  return Vec.create(event.clientX - bounds.left, event.clientY - bounds.top);
};

canvas.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);

    drag = {
      pointer: pointerPosition(event),
      position: Vec.clone(camera().position),
      moved: false,
    };
  },
  listen,
);

canvas.addEventListener(
  'pointermove',
  (event) => {
    pointer = pointerPosition(event);

    if (drag) {
      const delta = Vec.subtract(pointer, drag.pointer);

      drag.moved ||= Vec.length(delta) > 3;
      Vec.set(
        camera().position,
        Vec.subtract(drag.position, Vec.scale(delta, 1 / pixelsPerUnit())),
      );
    }

    redraw();
  },
  listen,
);

canvas.addEventListener(
  'pointerup',
  (event) => {
    if (!drag) return;
    pointer = pointerPosition(event);
    const clicked = state.view === 'world' && !drag.moved && hoveredSector();

    drag = undefined;

    if (clicked) {
      selectSector(clicked.id);
      return;
    }

    changed();
  },
  listen,
);

canvas.addEventListener(
  'pointercancel',
  () => {
    drag = undefined;
    changed();
  },
  listen,
);

canvas.addEventListener(
  'pointerleave',
  () => {
    pointer = undefined;
    redraw();
  },
  listen,
);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const point = pointerPosition(event);
    const before = location(point);
    const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.0015)));

    camera().span = Math.max(
      state.view === 'world' ? 200 : 2000,
      Math.min(state.view === 'world' ? 8000 : 4000000, camera().span * factor),
    );
    Vec.set(
      camera().position,
      Vec.add(camera().position, Vec.subtract(before, location(point))),
    );
    changed();
  },
  { ...listen, passive: false },
);

updateControls();

const resize = new ResizeObserver(() => {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  if (!camera().span) fit();
  changed();
});

resize.observe(canvas);
import.meta.hot?.accept();

import.meta.hot?.dispose((data) => {
  data.state = state;
  events.abort();
  resize.disconnect();
  worker?.terminate();
  clearTimeout(timer);
  cancelAnimationFrame(frame);
});
