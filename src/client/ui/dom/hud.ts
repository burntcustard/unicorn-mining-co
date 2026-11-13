import { targetKinds } from '../target-kinds';
import './hud.css';
import html from './hud.html?raw';
import { query, ui } from './ui';
import { type Ship } from '../../objects/ship';
import { type GameObject } from '../../objects/game-object';
import { type Module } from '../../objects/modules/module';
import { type Pose } from '../../types';
import { moduleRowsOf } from '../controls';
import { defaultKeybindings, keyLabel } from '../../input/keybindings';
import { moduleCategoryIds } from '../../../specs/modules/categories';
import { powerParts } from './power';
import { minimapRange, renderMinimap } from '../minimap';
import { mapRange, renderSectorMap } from '../sector-map';
import { createMapFields } from '../map-fields';
import { type MapMarker } from '../../protocol/network';
import { JumpGate } from '../../objects/jump-gate';
import * as Vec from '../../utilities/vector';
import { reconcileRows } from '../../utilities/reconcile-rows';
import { colors } from '../../../specs/colors';
import { jumpGateSpec } from '../../../specs/jump-gate';
import { renderTargetPreview } from '../target-preview';

const hudInterval = 1000 / 30;

export const createHud = ({
  onToggle = () => {},
  onMapView = () => {},
  now = () => performance.now(),
}: {
  onToggle?: (Type: typeof Module) => void;
  onMapView?: (position: Vec.Value) => void;
  now?: () => number;
} = {}) => {
  const element = ui.hudElement;
  const template = document.createElement('template');

  template.innerHTML = html;
  const panels = Array.from(template.content.children) as HTMLElement[];

  element.append(template.content);
  const modulesPanel = query(element, '.hud-modules');
  const power = query(element, '[data-power-usage-bar]');
  const storage = query(element, '[data-power-storage]');
  const powerStore = query(element, '[data-store="power"]');
  const fuel = query(element, '[data-store="fuel"] .ui-power-track');
  const fuelSegments = Array.from(fuel.children);

  fuel.style.setProperty('--ui-color', colors.cyan[2]);
  storage.style.setProperty('--ui-color', colors.yellow[2]);
  query(element, '[data-power-generation]').style.setProperty(
    '--ui-color',
    colors.green[2],
  );
  query(element, '[data-power-usage]').style.setProperty(
    '--ui-color',
    colors.red[2],
  );
  const mapCanvas = query<HTMLCanvasElement>(element, '.hud-map canvas');
  const map = mapCanvas.getContext('2d', { willReadFrequently: true })!;
  const mapPanel = mapCanvas.parentElement!;
  const mapButton = query<HTMLButtonElement>(mapPanel, '[data-map-toggle]');
  const mapKey = query(mapButton, '[data-map-key]');
  const mapZoom = query(mapPanel, '.hud-map-zoom');
  const controller = new AbortController();
  const { signal } = controller;
  let expanded = false;
  let mapExpanded = false;
  let mapCollapse: ReturnType<typeof setTimeout> | undefined;
  let mapReady = true;
  let pendingMap = false;
  let mapCenter = Vec.create();
  let range = mapRange;
  let mapMarkers: MapMarker[] = [];
  let fields: ReturnType<typeof createMapFields> | undefined;
  let mapSeed: number | undefined;
  let displayName = '';
  let sectorName = '';
  let mapRequestedAt = -Infinity;

  let drag: { id: number; position: Vec.Value } | undefined;

  let mapWidth = 0;
  let mapOptions: Parameters<typeof renderMinimap>[0] | undefined;
  let nextMapDraw = -Infinity;

  const drawMap = (scheduled = false) => {
    if (!mapOptions) return;
    const time = now();

    nextMapDraw =
      scheduled && Number.isFinite(nextMapDraw)
        ? nextMapDraw +
          (Math.floor((time - nextMapDraw) / hudInterval) + 1) * hudInterval
        : time + hudInterval;
    const displayScale = (mapExpanded ? 600 : 300) / (mapWidth || 300);

    if (mapExpanded) {
      renderSectorMap({
        ...mapOptions,
        mapCenter,
        range,
        mapMarkers: fields
          ? [...fields(mapCenter, range), ...mapMarkers]
          : mapMarkers,
        displayName,
        displayScale,
      });
    } else {
      renderMinimap({ ...mapOptions, displayScale });
    }
  };

  const toggleMap = () => {
    if (!mapOptions || mapPanel.hidden) return;

    if (!expanded && !mapReady) {
      pendingMap = !pendingMap;
      return;
    }

    pendingMap = false;
    stopDrag();
    expanded = !expanded;

    if (expanded) {
      mapCenter = Vec.clone(
        (mapOptions.poses.get(mapOptions.ship.id) || mapOptions.ship).position,
      );
    }

    mapRequestedAt = -Infinity;
    mapPanel.classList.toggle('hud-map-expanded', expanded);
    mapZoom.inert = !expanded;
    mapButton.setAttribute('aria-pressed', String(expanded));
    mapButton.setAttribute('aria-expanded', String(expanded));
    clearTimeout(mapCollapse);

    const updateMap = () => {
      mapExpanded = expanded;
      mapCanvas.width = mapCanvas.height = mapExpanded ? 600 : 300;
      mapCanvas.setAttribute(
        'aria-label',
        mapExpanded
          ? `Sector map, north up, range ${range.toLocaleString('en-US')} meters.`
          : `Nearby objects, north up, range ${minimapRange.toLocaleString('en-US')} meters`,
      );
      drawMap();
    };

    if (expanded) {
      updateMap();
    } else {
      mapCollapse = setTimeout(updateMap, 100);
    }
  };

  const zoomMap = (direction: number) => {
    if (!expanded || mapPanel.hidden) return;
    range = Math.max(
      mapRange / 4,
      Math.min(mapRange * 4, range * (direction > 0 ? 0.5 : 2)),
    );
    mapCanvas.setAttribute(
      'aria-label',
      `Sector map, north up, range ${range.toLocaleString('en-US')} meters.`,
    );
    drawMap();
  };

  for (const [selector, direction] of [
    ['[data-map-zoom-in]', 1],
    ['[data-map-zoom-out]', -1],
  ] as const) {
    query<HTMLButtonElement>(mapPanel, selector).addEventListener(
      'click',
      (event) => {
        zoomMap(direction);
        (event.currentTarget as HTMLButtonElement).blur();
      },
      { signal },
    );
  }

  mapButton.addEventListener(
    'click',
    () => {
      toggleMap();
      mapButton.blur();
    },
    { signal },
  );

  mapCanvas.addEventListener(
    'pointerdown',
    (event) => {
      if (!expanded || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      mapCanvas.setPointerCapture(event.pointerId);

      drag = {
        id: event.pointerId,
        position: Vec.create(event.clientX, event.clientY),
      };

      mapPanel.classList.add('hud-map-dragging');
    },
    { signal },
  );

  mapCanvas.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const position = Vec.create(event.clientX, event.clientY);
      const delta = Vec.scale(
        Vec.subtract(position, drag.position),
        (range * 600) / (296 * (mapWidth || 600)),
      );

      Vec.subtract(mapCenter, delta, mapCenter);
      mapCenter.x = Math.max(-1e9, Math.min(1e9, mapCenter.x));
      mapCenter.y = Math.max(-1e9, Math.min(1e9, mapCenter.y));
      drag.position = position;
      drawMap();
    },
    { signal },
  );

  const stopDrag = () => {
    const id = drag?.id;

    drag = undefined;

    if (id !== undefined && mapCanvas.hasPointerCapture(id)) {
      mapCanvas.releasePointerCapture(id);
    }

    mapPanel.classList.remove('hud-map-dragging');
  };

  mapCanvas.addEventListener('lostpointercapture', stopDrag, { signal });

  mapCanvas.addEventListener(
    'pointerup',
    (event) => {
      if (mapCanvas.hasPointerCapture(event.pointerId)) {
        mapCanvas.releasePointerCapture(event.pointerId);
      }

      stopDrag();
    },
    { signal },
  );

  mapCanvas.addEventListener('pointercancel', stopDrag, { signal });

  const mapResize = new ResizeObserver(([entry]) => {
    mapWidth = Math.round(entry.contentRect.width);

    if (mapWidth && mapOptions) {
      drawMap();
    }
  });

  mapResize.observe(mapCanvas);

  mapCanvas.setAttribute(
    'aria-label',
    `Nearby objects, north up, range ${minimapRange.toLocaleString('en-US')} meters`,
  );
  const targetPanel = query(element, '.hud-target');

  element
    .querySelectorAll<HTMLButtonElement>('.hud-stores button')
    .forEach((button) => {
      button.style.setProperty('--ui-color', colors.white[2]);
      button.addEventListener('click', () => button.blur());
    });

  let moduleKey = '';
  let powerKey = '';
  let previousTarget: GameObject | undefined;

  let rows: { Type: typeof Module; element: HTMLElement }[] = [];

  const nodes = new Map<string, HTMLElement>();

  const node = (selector: string) => {
    let found = nodes.get(selector);

    if (!found) {
      found = query(element, selector);
      nodes.set(selector, found);
    }

    return found;
  };

  const text = (selector: string, value: string) => {
    const target = node(selector);

    if (target.textContent !== value) target.textContent = value;
  };

  const attribute = (target: Element, name: string, value: string) => {
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  };

  const hidden = (target: HTMLElement, value: boolean) => {
    if (target.hidden !== value) target.hidden = value;
  };

  const style = (target: HTMLElement, name: string, value: string) => {
    if (target.style.getPropertyValue(name) !== value) {
      target.style.setProperty(name, value);
    }
  };

  let isShown = false;
  let nextInstruments = -Infinity;
  let instrumentShipId: number | undefined;

  const setShown = (shown: boolean) => {
    if (shown === isShown) return;
    isShown = shown;

    if (!shown) {
      nextInstruments = -Infinity;
      nextMapDraw = -Infinity;
    }

    panels.forEach((panel) => {
      panel.hidden = !shown;
    });
  };

  return {
    setShown,
    toggleMap,
    zoomMap,
    destroy() {
      controller.abort();
      clearTimeout(mapCollapse);
      mapResize.disconnect();
      mapOptions = undefined;
      panels.forEach((panel) => element.removeChild(panel));
    },
    update({
      ship,
      credits,
      displayName: nextDisplayName,
      sectorName: nextSectorName,
      worldSeed,
      mapReady: nextMapReady = true,
      mapMarkers: nextMapMarkers = [],
      target,
      objects,
      asteroidPositions,
      poses,
      shown,
    }: {
      ship: Ship;
      credits: number;
      displayName: string;
      sectorName: string;
      worldSeed?: number;
      mapReady?: boolean;
      mapMarkers?: MapMarker[];
      target?: GameObject;
      objects: GameObject[];
      asteroidPositions?: Vec.Value[];
      poses: Map<number, Pose>;
      shown: boolean;
    }) {
      setShown(shown);

      if (!shown) {
        pendingMap = false;
        nextMapDraw = -Infinity;
        stopDrag();
        return;
      }

      const mapBinding =
        defaultKeybindings.sectorMap.keys.map(keyLabel).join(' / ') || '—';

      if (mapKey.textContent !== mapBinding) mapKey.textContent = mapBinding;
      displayName = nextDisplayName;
      mapMarkers = nextMapMarkers;
      mapReady = nextMapReady;
      hidden(mapPanel, expanded && !mapReady);

      const sectorChanged =
        sectorName !== nextSectorName || mapSeed !== worldSeed;

      if (sectorChanged) {
        sectorName = nextSectorName;
        mapSeed = worldSeed;
        fields =
          worldSeed === undefined
            ? undefined
            : createMapFields({ worldSeed, sectorName });
        mapCenter = Vec.clone((poses.get(ship.id) || ship).position);
        mapRequestedAt = -Infinity;
      }

      // The first visible frame measures once; later resizes arrive after layout.
      // Avoid flushing pending instrument or world styles on every frame.
      if (!mapWidth) mapWidth = mapCanvas.clientWidth;
      const displayScale = 300 / (mapWidth || 300);

      mapOptions = {
        ctx: map,
        ship,
        objects,
        poses,
        target,
        asteroidPositions,
        displayScale,
      };

      if (pendingMap && mapReady) toggleMap();

      const mapTime = now();

      if (
        (expanded || !mapReady) &&
        mapTime - mapRequestedAt >= (expanded ? 250 : 1000)
      ) {
        mapRequestedAt = mapTime;
        onMapView(Vec.clone(mapCenter));
      }

      const instrumentTime = now();

      // Instrument values can update independently of map interactions and
      // target handling; keep the first frame after a context change current.
      if (
        instrumentTime >= nextInstruments ||
        sectorChanged ||
        instrumentShipId !== ship.id
      ) {
        nextInstruments =
          !sectorChanged &&
          instrumentShipId === ship.id &&
          Number.isFinite(nextInstruments)
            ? nextInstruments +
              (Math.floor((instrumentTime - nextInstruments) / hudInterval) +
                1) *
                hudInterval
            : instrumentTime + hudInterval;
        instrumentShipId = ship.id;
        text('[data-pilot]', displayName);
        text('[data-credits]', `${credits.toLocaleString('en-US')}$`);
        text('[data-sector]', sectorName);
        const x = String(Math.round(ship.position.x));
        const y = String(Math.round(ship.position.y));
        const coordinateWidth = Math.max(6, x.length, y.length);

        text(
          '[data-coordinates]',
          `${x.padStart(coordinateWidth)}\u2009/\u2009${y.padEnd(coordinateWidth)}`,
        );

        const cargoCount = ship.cargoContents.length;

        hidden(node('[data-cargo-full]'), cargoCount < ship.cargoSpace);

        style(fuel, 'width', `${ship.fuelCapacity}px`);
        const fuelFraction =
          ship.fuelCapacity > 0
            ? Math.max(0, Math.min(1, ship.fuel / ship.fuelCapacity))
            : 0;

        fuelSegments.forEach((segment, index) => {
          segment.classList.toggle(
            'filled',
            index < Math.ceil(fuelFraction * 8),
          );
        });

        fuel.classList.toggle(
          'hud-fuel-low',
          ship.fuelCapacity > 0 && fuelFraction <= 1 / 8,
        );
        attribute(fuel, 'aria-valuenow', String(ship.fuel));
        attribute(
          fuel,
          'aria-valuemax',
          String(Math.max(ship.fuelCapacity, 1)),
        );

        text('[data-cargo-current]', String(cargoCount));
        text('[data-cargo-capacity]', String(ship.cargoSpace));
        text(
          '#hud-fuel-tooltip',
          `Fuel: ${ship.fuel.toFixed(1)} / ${ship.fuelCapacity} L`,
        );
        text(
          '#hud-cargo-tooltip',
          `Cargo: ${cargoCount} / ${ship.cargoSpace} slots`,
        );

        const modules = moduleRowsOf(ship);
        const labels = modules.map(({ binding, name }) => [
          binding.keys.map(keyLabel).join(' / ') || '—',
          name,
        ]);

        const nextKey = JSON.stringify(labels);

        if (moduleKey !== nextKey) {
          moduleKey = nextKey;
          modulesPanel.replaceChildren();

          rows = modules.map(({ Type }, index) => {
            const row = document.createElement('button');
            const kbd = document.createElement('kbd');
            const name = document.createElement('span');

            row.className = 'ui-control flex items-center gap-3';
            row.type = 'button';

            row.addEventListener('click', () => {
              onToggle(Type);
              row.blur();
            });

            kbd.className = 'flex-none';

            kbd.textContent = labels[index][0];
            name.className = 'text-sm';
            name.textContent = labels[index][1];
            row.append(kbd, name);
            modulesPanel.append(row);
            return { Type, element: row };
          });
        }

        hidden(modulesPanel, !rows.length);

        rows.forEach(({ Type, element: row }) => {
          const active = ship.moduleActive({ module: Type });

          attribute(row, 'aria-pressed', String(active));
        });

        const entries = ship.powerEntries.sort(
          (a, b) =>
            moduleCategoryIds.indexOf(a.module.category) -
            moduleCategoryIds.indexOf(b.module.category),
        );
        let output = 0;
        let total = 0;
        let capacity = 0;

        entries.forEach(({ module, value }) => {
          output += module.powerGenerated || 0;
          total += value;
          capacity += module.powerCapacity || 0;
        });

        const scale = Math.max(output * 1.5, 1);

        style(power, '--ui-power-generation', `${(output / scale) * 100}%`);

        attribute(storage, 'aria-valuenow', String(ship.storedPower));
        attribute(storage, 'aria-valuemax', String(Math.max(capacity, 1)));
        text(
          '[data-power-label]',
          `${Math.round(ship.storedPower)}/${Math.round(capacity)}`,
        );
        attribute(
          storage,
          'aria-valuetext',
          `${ship.storedPower.toFixed(1)} of ${capacity.toFixed(1)} MJ`,
        );
        style(
          query(storage, '.ui-power-part'),
          'width',
          `${capacity > 0 ? Math.max(0, Math.min(1, ship.storedPower / capacity)) * 100 : 0}%`,
        );
        const net = Number((output - total).toFixed(1));

        style(
          powerStore,
          '--ui-color',
          ship.storedPower > 0 ? colors.yellow[2] : colors.red[2],
        );
        text('[data-power-usage]', total.toFixed(1));
        text('[data-power-generation]', output.toFixed(1));
        text('[data-power-net]', `${net >= 0 ? '+' : ''}${net.toFixed(1)}`);

        const parts = powerParts({ entries, scale });

        if (parts !== powerKey) {
          reconcileRows(power, parts);
          powerKey = parts;
        }

        attribute(power, 'aria-valuenow', String(total));
        attribute(power, 'aria-valuemax', String(scale));
        attribute(
          power,
          'aria-valuetext',
          `${total.toFixed(1)} of ${output.toFixed(1)} MW`,
        );

        text(
          '[data-store="power"] .ui-tooltip-content',
          `Stored: ${ship.storedPower.toFixed(1)} / ${capacity.toFixed(1)} MJ\nUsage: ${total.toFixed(1)} MW\nGeneration: ${output.toFixed(1)} MW`,
        );
      }

      hidden(targetPanel, !target);

      if (target) {
        const description =
          target instanceof JumpGate &&
          Vec.distanceSquared(ship.position, target.position) >
            jumpGateSpec.approachRadius ** 2
            ? 'Move closer to request access'
            : target.targetLabel?.split('\n').at(-1) || target.description;

        text('[data-description]', description || '');
        hidden(node('[data-description]'), !description);
        text(
          '[data-distance]',
          `${Math.round(Vec.distance(ship.position, (poses.get(target.id) || target).position)).toLocaleString('en-US')}\u2009m`,
        );

        if (target !== previousTarget) {
          text('[data-name]', target.name.replaceAll('\n', ' '));
          text('[data-kind]', targetKinds.get(target.kind!) || '');
          const price = target.price;

          hidden(node('[data-value-row]'), price === undefined);
          text(
            '[data-value]',
            `${Number(price || 0).toLocaleString('en-US')}$`,
          );
          const canvas = document.createElement('canvas');

          renderTargetPreview(canvas, target);
          query(element, '.hud-target-icon').replaceChildren(canvas);
        }
      }

      previousTarget = target;

      // Radar contacts need not be repainted at the display frame rate.
      // Direct map interactions and resizing still draw immediately.
      if (now() >= nextMapDraw) drawMap(true);
    },
  };
};
