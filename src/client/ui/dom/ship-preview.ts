import { Item } from '../../objects/item';
import { type ItemSpec } from '../../../specs/items/types';
import { Ship } from '../../objects/ship';
import { Module } from '../../objects/modules/module';
import { game } from '../../game';
import {
  renderingLayers,
  type RenderingLayer,
} from '../../../specs/rendering-layers';
import { type Segment } from '../../types';
import { moduleTypes, moduleTypesById } from '../../objects/modules';
import { mustang, type ShipId } from '../../../specs/ships';
import { paintColors, colors } from '../../../specs/colors';
import { type ShipPreview } from './identity';
import { rotatePoint, rotatePoints } from '../../utilities/geometry';

const layers = Object.values(renderingLayers);

const createShipPreview = (canvas: HTMLCanvasElement) => {
  let buffers: HTMLCanvasElement[];
  let ship: Ship;
  let hullIndex = -1;
  let loadout = '';
  let frame = 0;
  let previousTime = 0;
  let fitting: Module | undefined;
  let replacedModule: Module | 0 = 0;
  let fittingKey = '';

  let pendingFitting: {
    candidate?: Module | typeof Module;
    mount: number;
    active: boolean;
  } = { mount: -1, active: true };

  const thumbnails = new WeakMap<HTMLCanvasElement, string>();

  const updateActivation = () => {
    const { candidate, mount, active } = pendingFitting;
    const key = candidate
      ? JSON.stringify([candidate.definitionId, candidate.shades, mount])
      : '';

    // Finish retracting the old fitting before removing or replacing it.
    if (
      fittingKey !== key &&
      !ship.segments.some(
        (segment) => segment.module === fitting && segment.activationProgress,
      )
    ) {
      if (fitting) {
        ship.fit(replacedModule, fitting.mount);
        ship.cargoContents = ship.cargoContents.filter(
          (module) => module !== fitting,
        );
      }

      fitting = undefined;
      fittingKey = key;

      if (candidate && mount >= 0) {
        const Type = (
          typeof candidate === 'function' ? candidate : candidate.constructor
        ) as typeof Module;

        replacedModule = ship.mounts[mount].module || 0;
        fitting = new Type({ shades: candidate.shades });
        ship.fit(fitting, ship.mounts[mount]);
      }
    }

    const activeMount = ship.mounts[mount];

    ship.segments.forEach((segment) =>
      ship.setSegmentActive(
        segment,
        +(
          active &&
          !!activeMount &&
          segment.mount === activeMount &&
          (segment.module !== fitting || fittingKey === key)
        ),
      ),
    );
  };

  const hullAt = (index: number) =>
    ship.segments.find(
      (segment) => segment.hull && segment.module === ship.hullSegments[index],
    );

  const render = (
    target: HTMLCanvasElement,
    {
      segments = ship.segments,
      scale,
      x = target.width / 2,
      y = target.height / 2,
      zIndex,
    }: {
      segments?: Segment[];
      scale: number;
      x?: number;
      y?: number;
      zIndex?: RenderingLayer;
    },
  ) => {
    const ctx = target.getContext('2d')!;
    const previousContext = game.ctx,
      previousScale = game.scale;
    const all = ship.segments;

    ctx.clearRect(0, 0, target.width, target.height);
    ctx.save();

    try {
      game.ctx = ctx;
      game.scale = scale;
      ship.segments = segments;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      (zIndex === undefined ? layers : [zIndex]).forEach((zIndex) =>
        ship.render({ zIndex }),
      );
    } finally {
      ship.segments = all;
      game.ctx = previousContext;
      game.scale = previousScale;
      ctx.restore();
    }
  };

  const draw = (time: number) => {
    frame = 0;

    if (!ship || !canvas.getClientRects().length) return;
    const dt = Math.min((time - (previousTime || time)) / 1000, 0.05);

    previousTime = time;
    ship.updateModules(dt);
    updateActivation();
    ship.updateVisual(dt);

    if (
      ship.segments.some(
        (segment) => segment.active || segment.activationProgress,
      )
    ) {
      requestDraw();
    } else previousTime = 0;

    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.round(box.width * ratio),
      height = Math.round(box.height * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const scale = Math.min(width / 115, height / 100);

    if (hullIndex < 0) {
      render(canvas, { scale });
      return;
    }

    buffers ||= Array.from({ length: 3 }, () =>
      document.createElement('canvas'),
    );

    buffers.forEach((target) => {
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
    });

    const [buffer, selection, layer] = buffers;
    const selected = hullAt(hullIndex);
    const isSelected = (segment: Segment) =>
      segment === selected || segment.mount?.hull === selected;

    const full = buffer.getContext('2d')!;
    const visible = selection.getContext('2d')!;
    const groups = [false, true].map((focused) =>
      ship.segments.filter((segment) => isSelected(segment) === focused),
    );

    full.clearRect(0, 0, width, height);
    visible.clearRect(0, 0, width, height);

    // Keep normal occlusion in both images. Higher unselected layers erase
    // covered selection pixels; selection is raised only within its own layer.
    layers.forEach((zIndex) => {
      groups.forEach((segments, focused) => {
        render(layer, { segments, scale, zIndex });
        full.drawImage(layer, 0, 0);
        visible.globalCompositeOperation = focused
          ? 'source-over'
          : 'destination-out';
        visible.drawImage(layer, 0, 0);
      });
    });

    // Add the visible selection's other half without building up opacity at
    // overlaps between unselected parts or exposing covered module geometry.
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(buffer, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(selection, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };

  const thumbnail = (
    target: HTMLCanvasElement,
    index: number,
    { outline = false } = {},
  ) => {
    const segment = hullAt(index);

    if (!segment || !Array.isArray(segment.points)) return;
    const points = rotatePoints(
      segment.points,
      ship.rotation,
      rotatePoint(segment.localPosition, ship.rotation),
    );
    const size = Math.round(target.clientWidth * Math.min(devicePixelRatio, 2));
    const color = outline
      ? getComputedStyle(target).getPropertyValue('color')
      : undefined;
    const image = JSON.stringify([
      points,
      size,
      outline,
      outline ? color : [segment.health, segment.shades],
    ]);

    if (!size || thumbnails.get(target) === image) return;
    thumbnails.set(target, image);
    itemThumbnails.delete(target);

    const xs = points.map((point) => point[0]),
      ys = points.map((point) => point[1]);
    const left = Math.min(...xs) - 1,
      top = Math.min(...ys) - 1;
    const width = Math.max(...xs) + 1 - left,
      height = Math.max(...ys) + 1 - top;

    target.width = target.height = size;
    const scale = size / Math.max(width, height);
    const x = (size - width * scale) / 2 - left * scale,
      y = (size - height * scale) / 2 - top * scale;

    if (outline) {
      const ctx = target.getContext('2d')!;

      ctx.strokeStyle = color;
      ctx.lineWidth = size / target.clientWidth;
      ctx.beginPath();
      points.forEach(([px, py]) => ctx.lineTo(x + px * scale, y + py * scale));
      ctx.closePath();
      ctx.stroke();
      return;
    }

    render(target, {
      segments: [segment],
      scale,
      x,
      y,
    });
  };

  const requestDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const observer = new ResizeObserver(requestDraw);

  observer.observe(canvas);

  return {
    update(
      source?: Ship | ShipPreview,
      {
        hull = -1,
        mount = -1,
        candidate,
        active = true,
      }: {
        hull?: number;
        mount?: number;
        candidate?: Module | typeof Module;
        active?: boolean;
      } = {},
    ) {
      const live = source instanceof Ship ? source : undefined;
      const saved = Array.isArray(source) ? source : undefined;
      const states = live?.moduleStates.filter((state) => state.mount >= 0);
      const nextLoadout = JSON.stringify(
        live
          ? [
              live.definitionId,
              live.hullHealth.map((health) => health < 1),
              states.map(({ type, mount }) => [type, mount]),
            ]
          : saved && [
              saved[0],
              saved[2].map((health) => health < 1),
              saved[3].map(([type, mount]) => [type, mount]),
            ],
      );

      const rebuilding = loadout !== nextLoadout;

      if (rebuilding) {
        loadout = nextLoadout;
        fitting = undefined;
        fittingKey = '';
        previousTime = 0;

        ship = new Ship({
          shipType: live?.definitionId || (saved?.[0] as ShipId),
          shades:
            live?.shades || (saved && paintColors[saved[1]]) || colors.white,
          rotation: -0.4,
        });

        if (live) {
          ship.hullHealth = live.hullHealth;
          ship.moduleStates = states;
        } else if (!saved) {
          mustang.initialLoadout.forEach(({ module, mount }) => {
            const Type = moduleTypesById.get(module)!;

            ship.fit(new Type(), ship.mounts[mount]);
          });
        }
      }

      if (live || saved) {
        ship.shades = live?.shades || paintColors[saved[1]] || colors.white;
        ship.hullHealth = live?.hullHealth || saved[2];

        ship.segments
          .filter((segment) => segment.hull)
          .forEach((segment) => {
            segment.shades = ship.shades;
          });

        const mounts = ship.mounts;

        const modules =
          states ||
          saved[3].map(([type, mount, paint, health]) => ({
            type,
            mount,
            health,
            healthActivated: undefined as number | undefined,
            shades: paintColors[paint] || colors.violet,
          }));

        modules.forEach((state) => {
          const Type = moduleTypes[state.type];
          let index = state.mount;

          if (!Type || !mounts[index]) return;

          // Cached Mustang previews may still use the old rear power-plant slot.
          if (
            saved &&
            ship.definitionId === 'mustang' &&
            index >= 3 &&
            index <= 6 &&
            !mounts[index].fits.includes(Type)
          ) {
            const updated = index === 6 ? 3 : index + 1;

            if (mounts[updated].fits.includes(Type)) index = updated;
          }

          const mount = mounts[index];

          if (saved && rebuilding) {
            ship.fit(new Type({ shades: state.shades }), mount);
          }

          const module = mount.module;

          if (!module) return;

          if (state.health != null) mount.health = state.health;
          mount.healthActivated =
            state.healthActivated ?? module.healthActivated;
          module.shades = state.shades || ship.shades;

          ship.segmentsAtMount(mount).forEach((segment) => {
            segment.shades = module.shades;
          });
        });
      }

      if (rebuilding) {
        ship.segments.forEach((segment) => {
          segment.active = segment.activationProgress = 0;
        });
      }

      hullIndex = hull;
      pendingFitting = { candidate, mount, active };
      updateActivation();
      requestDraw();
    },
    thumbnail,
    clearThumbnail: (target: HTMLCanvasElement) => thumbnails.delete(target),
    destroy: () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
};

const itemThumbnails = new WeakMap<HTMLCanvasElement, string>();

const itemThumbnail = (
  target: HTMLCanvasElement,
  source: Module | ItemSpec,
) => {
  const size = Math.round(target.clientWidth * Math.min(devicePixelRatio, 2));
  const key = JSON.stringify([
    size,
    source instanceof Module ? source.definitionId : source.resource,
    source.shades,
  ]);

  if (!size || itemThumbnails.get(target) === key) return;
  itemThumbnails.set(target, key);
  const module = source instanceof Module;

  const object = module
    ? new Ship({
        rotation: -0.4,
        hullSegments: [
          {
            health: 1,
            points: [
              [-1, -1],
              [1, -1],
              [0, 1],
            ],
            mounts: [[{ x: 0, y: 1, fits: [source.definitionId] }]],
          },
        ],
      })
    : new Item(source, { rotation: -0.4 });

  let points: number[][];

  if (object instanceof Ship) {
    const Type = source.constructor as typeof Module;

    object.fit(new Type({ shades: source.shades }));
    object.segments = object.segments.filter(
      (segment) => !segment.hull && !segment.catches && !segment.covers,
    );

    points = object.segments.flatMap((segment) => {
      const points =
        typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points;
      const radius = segment.radius?.(segment) || 0;

      return rotatePoints(
        points?.length
          ? points
          : [
              [-radius, -radius],
              [radius, radius],
            ],
        object.rotation,
        rotatePoint(segment.localPosition, object.rotation),
      );
    });
  } else {
    const radius = object.radius;

    points = rotatePoints(
      object.points || [
        [-radius, -radius],
        [radius, radius],
      ],
      object.rotation,
    );
  }

  if (!points.length) return;
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  if (object instanceof Item) {
    rotatePoints(object.lines?.flat() || [], object.rotation).forEach(
      ([x, y]) => {
        xs.push(x);
        ys.push(y);
      },
    );

    if (object.glint) {
      const radius = object.radius;
      const [[x, y]] = rotatePoints(
        [[radius * 0.3, radius * -0.28]],
        object.rotation,
      );
      // Fit the upright sparkle by zooming out around the body's center.
      const reach = radius * 1.2;

      xs.push(x - reach, x + reach);
      ys.push(y - reach, y + reach);
    }
  }

  const width = Math.max(...xs.map((x) => Math.abs(x - centerX))) * 2 + 6,
    height = Math.max(...ys.map((y) => Math.abs(y - centerY))) * 2 + 6;
  const scale = size / Math.max(width, height);
  const ctx = target.getContext('2d')!;
  const previousContext = game.ctx,
    previousScale = game.scale;

  target.width = target.height = size;
  ctx.save();

  try {
    game.ctx = ctx;
    game.scale = scale;
    ctx.translate(size / 2 - centerX * scale, size / 2 - centerY * scale);
    ctx.scale(scale, scale);

    if (object instanceof Ship) {
      layers.forEach((zIndex) => object.render({ zIndex }));
    } else object.render();
  } finally {
    game.ctx = previousContext;
    game.scale = previousScale;
    ctx.restore();
  }
};

export default { createShipPreview, itemThumbnail };
