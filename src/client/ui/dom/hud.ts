import { targetKinds } from '../target-kinds';
import './hud.css';
import html from './hud.html?raw';
import pentagon from '../icons/corral-5.svg?raw';
import hexagon from '../icons/corral-6.svg?raw';
import { query, ui } from './ui';
import { type Ship } from '../../objects/ship';
import { type GameObject } from '../../objects/game-object';
import { type Module } from '../../objects/modules/module';
import { type Pose } from '../../types';
import { moduleRowsOf } from '../controls';
import { keyLabel } from '../../input/keybindings';
import { moduleCategoryIds } from '../../../specs/modules/categories';
import { powerParts } from './power';
import { minimapRange, renderMinimap } from '../minimap';
import { shipIcon } from './ship-icon';
import { Craft } from '../../objects/craft';
import { Item } from '../../objects/item';
import { JumpGate } from '../../objects/jump-gate';
import * as Vec from '../../utilities/vector';
import { reconcileRows } from '../../utilities/reconcile-rows';
import { colors } from '../../../specs/colors';
import { jumpGateSpec } from '../../../specs/jump-gate';

export const createHud = ({
  onToggle = () => {},
}: { onToggle?: (Type: typeof Module) => void } = {}) => {
  const element = ui.element;
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
  const map = mapCanvas.getContext('2d')!;

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

  const text = (selector: string, value: string) => {
    const node = query(element, selector);

    if (node.textContent !== value) node.textContent = value;
  };

  const setShown = (shown: boolean) =>
    panels.forEach((panel) => {
      panel.hidden = !shown;
    });

  return {
    setShown,
    destroy() {
      panels.forEach((panel) => element.removeChild(panel));
    },
    update({
      ship,
      credits,
      displayName,
      sectorName,
      target,
      objects,
      asteroidPositions,
      poses,
      shown,
      alpha,
    }: {
      ship: Ship;
      credits: number;
      displayName: string;
      sectorName: string;
      target?: GameObject;
      objects: GameObject[];
      asteroidPositions?: Vec.Value[];
      poses: Map<number, Pose>;
      shown: boolean;
      alpha: number;
    }) {
      setShown(shown);

      if (!shown) return;

      panels.forEach((panel) => {
        panel.style.opacity = String(alpha);
      });

      text('[data-pilot]', displayName);
      text('[data-credits]', `${credits.toLocaleString('en-US')}$`);
      text('[data-sector]', sectorName);
      text('[data-coordinate-x]', String(Math.round(ship.position.x)));
      text('[data-coordinate-y]', String(Math.round(ship.position.y)));

      const cargoCount = ship.cargoContents.length;

      query(element, '[data-cargo-full]').hidden = cargoCount < ship.cargoSpace;

      fuel.style.width = `${ship.fuelCapacity}px`;
      const fuelFraction =
        ship.fuelCapacity > 0
          ? Math.max(0, Math.min(1, ship.fuel / ship.fuelCapacity))
          : 0;

      fuelSegments.forEach((segment, index) => {
        segment.classList.toggle('filled', index < Math.ceil(fuelFraction * 8));
      });

      fuel.classList.toggle(
        'hud-fuel-low',
        ship.fuelCapacity > 0 && fuelFraction <= 1 / 8,
      );
      fuel.setAttribute('aria-valuenow', String(ship.fuel));
      fuel.setAttribute(
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

          row.className = 'flex items-center gap-3';
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

      modulesPanel.hidden = !rows.length;

      rows.forEach(({ Type, element: row }) => {
        const active = ship.moduleActive({ module: Type });

        row.setAttribute('aria-pressed', String(active));
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

      powerStore.style.setProperty('--hud-power-width', `${scale * 30}px`);
      power.style.setProperty(
        '--ui-power-generation',
        `${(output / scale) * 100}%`,
      );

      storage.setAttribute('aria-valuenow', String(ship.storedPower));
      storage.setAttribute('aria-valuemax', String(Math.max(capacity, 1)));
      text(
        '[data-power-label]',
        `${Math.round(ship.storedPower)}/${Math.round(capacity)}`,
      );
      storage.setAttribute(
        'aria-valuetext',
        `${ship.storedPower.toFixed(1)} of ${capacity.toFixed(1)} MJ`,
      );
      query(storage, '.ui-power-part').style.width =
        `${capacity > 0 ? Math.max(0, Math.min(1, ship.storedPower / capacity)) * 100 : 0}%`;
      const net = Number((output - total).toFixed(1));

      powerStore.style.setProperty(
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

      power.setAttribute('aria-valuenow', String(total));
      power.setAttribute('aria-valuemax', String(scale));
      power.setAttribute(
        'aria-valuetext',
        `${total.toFixed(1)} of ${output.toFixed(1)} MW`,
      );

      text(
        '[data-store="power"] .ui-tooltip-content',
        `Stored: ${ship.storedPower.toFixed(1)} / ${capacity.toFixed(1)} MJ\nUsage: ${total.toFixed(1)} MW\nGeneration: ${output.toFixed(1)} MW`,
      );

      targetPanel.hidden = !target;

      if (target) {
        const description =
          target instanceof JumpGate &&
          Vec.distanceSquared(ship.position, target.position) >
            jumpGateSpec.approachRadius ** 2
            ? 'Move closer to request access'
            : target.targetLabel?.split('\n').at(-1) || target.description;

        text('[data-description]', description || '');
        query(element, '[data-description]').hidden = !description;
        text(
          '[data-distance]',
          `${Math.round(Vec.distance(ship.position, (poses.get(target.id) || target).position)).toLocaleString('en-US')}\u2009m`,
        );

        if (target !== previousTarget) {
          text('[data-name]', target.name.replaceAll('\n', ' '));
          text('[data-kind]', targetKinds.get(target.kind!) || '');
          const price = target.price;

          query(element, '[data-value-row]').hidden = price === undefined;
          text(
            '[data-value]',
            `${Number(price || 0).toLocaleString('en-US')}$`,
          );
          const icon = query(element, '.hud-target-icon');

          icon.replaceChildren();
          icon.style.color = target.kind === 'station' ? colors.green[2] : '';

          if (target.kind === 'station') {
            icon.innerHTML =
              target.definitionId === 'corral-6' ? hexagon : pentagon;
          } else if (target instanceof Craft) {
            icon.innerHTML = shipIcon(target);
          } else if (target instanceof Item) {
            const canvas = document.createElement('canvas');

            canvas.width = 128;
            canvas.height = 144;
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            const ctx = canvas.getContext('2d')!;

            ctx.translate(64, 72);
            const scale = 48 / Math.max(target.radius, 1);

            ctx.scale(scale, scale);

            target.render({
              ctx,
              pose: { position: Vec.create(), rotation: 0 },
            });

            icon.append(canvas);
          } else {
            icon.innerHTML =
              '<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor"><path d="M0-10 10 0 0 10-10 0Z"/></svg>';
          }
        }
      }

      previousTarget = target;

      renderMinimap({
        ctx: map,
        ship,
        objects,
        poses,
        target,
        asteroidPositions,
      });
    },
  };
};
