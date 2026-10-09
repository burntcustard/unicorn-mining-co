import html from './docked.html?raw';
import { createScreen, query, ui } from './ui';
import { player, paintUnlocked } from '../../player';
import { paintColors } from '../../../specs/colors';
import { dockedModel, type DockedSelection } from '../docked-model';
import { performDockedAction } from '../docked-actions';

const createDocked = () => {
  const screen = createScreen(html);
  const selection: DockedSelection = { section: -2, itemKey: '' };
  const sections = query(screen.element, '[data-sections]');
  const items = query(screen.element, '[data-items]');
  const status = query(screen.element, '.ui-status');
  let previousView = '';

  const swatches = paintColors.map((shades, i) => {
    const button = document.createElement('button');

    button.className = 'ui-swatch';
    button.style.setProperty('--paint', shades[2]);
    button.setAttribute(
      'aria-label',
      ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Violet', 'White'][i] +
        ' paint',
    );

    button.addEventListener(
      'click',
      () => {
        performDockedAction({
          ship: player.ship,
          selection,
          action: 'PAINT',
          paint: i,
        });

        screen.update();
      },
      { signal: screen.signal },
    );

    query(screen.element, '[data-paints]').append(button);
    return button;
  });

  // Reconcile by identity without replacing focused nodes or moving unchanged rows.
  const syncRows = (
    container: HTMLElement,
    rows: { key: string; label: string }[],
    selected: string,
  ) => {
    const keys = new Set(rows.map((row) => row.key));

    [...container.children].forEach((child) => {
      if (!keys.has(child.getAttribute('data-key'))) {
        container.removeChild(child);
      }
    });

    rows.forEach((row, i) => {
      let button = [...container.children].find(
        (child) => child.getAttribute('data-key') === row.key,
      ) as HTMLButtonElement;

      if (!button) {
        button = document.createElement('button');
        button.className = 'ui-choice';
        button.setAttribute('data-key', row.key);
      }

      if (button.textContent !== row.label) button.textContent = row.label;
      button.setAttribute('aria-pressed', String(row.key === selected));

      if (container.children[i] !== button) {
        container.insertBefore(button, container.children[i] || null);
      }
    });
  };

  const update = () => {
    const ship = player.ship;
    const model = dockedModel(ship, selection);

    if (model.selected) selection.itemKey = model.selected.key;
    const view = JSON.stringify([
      selection.section,
      selection.itemKey,
      model.rows.map((row) => [row.key, row.label]),
      ship.mounts.map(({ module }) => [
        module && module.id,
        module && module.name,
      ]),
      player.credits,
      ship.cargoContents.length,
      ship.cargoSpace,
      model.health,
      model.maxHealth,
      model.repairCost,
      model.item?.price,
      model.item?.shades,
      model.actions,
      player.unlockedPaints,
    ]);

    if (view === previousView) return;
    previousView = view;

    syncRows(
      sections,
      [
        { key: '-2', label: 'CARGO' },
        { key: '-1', label: 'HULL' },
        ...ship.mounts.map((mount, i) => ({
          key: String(i),
          label: `${i + 1} / ${(mount.module && mount.module.name.toUpperCase()) || 'EMPTY MOUNT'}`,
        })),
      ],
      String(selection.section),
    );

    syncRows(items, model.rows, selection.itemKey);
    query(screen.element, '[data-list-heading]').textContent = model.hull
      ? ''
      : model.cargo
        ? 'AVAILABLE CARGO'
        : 'COMPATIBLE MODULES';
    query(screen.element, '[data-balance]').textContent = `$${player.credits}`;
    query(screen.element, '#item-heading').textContent = model.hull
      ? 'HULL'
      : model.item?.name?.toUpperCase() || 'EMPTY';
    query(screen.element, '[data-health]').textContent =
      `${Math.floor(model.health)}/${model.maxHealth}`;
    query(screen.element, '[data-price]').textContent = model.hull
      ? '-'
      : `$${model.item?.price || 0}`;
    query(screen.element, '[data-repair]').textContent = `$${model.repairCost}`;
    query(screen.element, '[data-cargo]').textContent =
      `${ship.cargoContents.length}/${ship.cargoSpace}`;

    screen.element
      .querySelectorAll<HTMLButtonElement>('[data-command]')
      .forEach((button) => {
        const action = button.getAttribute('data-command');

        button.hidden = !model.actions.includes(action);
        button.disabled = model.disabled(action);
      });

    query(screen.element, '[data-paint-panel]').hidden = !model.canPaint;

    swatches.forEach((button, i) => {
      button.disabled = !paintUnlocked(paintColors[i]);
      button.setAttribute(
        'aria-pressed',
        String(model.item?.shades?.[2] === paintColors[i][2]),
      );
    });
  };

  sections.addEventListener(
    'click',
    (event) => {
      const button = (event.composedPath()[0] as Element).closest('button');

      if (!button) return;
      selection.section = Number(button.getAttribute('data-key'));
      selection.itemKey = '';
      status.textContent = '';
      update();
    },
    { signal: screen.signal },
  );

  items.addEventListener(
    'click',
    (event) => {
      const button = (event.composedPath()[0] as Element).closest('button');

      if (button) {
        selection.itemKey = button.getAttribute('data-key');
        status.textContent = '';
        update();
      }
    },
    { signal: screen.signal },
  );

  query(screen.element, '[data-actions]').addEventListener(
    'click',
    (event) => {
      const button = (event.composedPath()[0] as Element).closest('button');

      if (!button || button.disabled) return;

      const applied = performDockedAction({
        ship: player.ship,
        selection,
        action: button.getAttribute('data-command'),
      });

      if (applied?.action === 'buy') {
        selection.itemKey = `owned-${applied.moduleId}`;
      }

      status.textContent = 'Action requested.';
      update();
    },
    { signal: screen.signal },
  );

  const launch = () => {
    player.ship.launchRequested = 1;
    ui.clear();
  };

  query(screen.element, '[data-launch]').addEventListener('click', launch, {
    signal: screen.signal,
  });

  query(screen.element, '[data-back]').addEventListener(
    'click',
    () => {
      if (selection.section !== -2) {
        selection.section = -2;
        selection.itemKey = '';
        update();
      } else window.dispatchEvent(new Event('ui-main-menu'));
    },
    { signal: screen.signal },
  );

  query(screen.element, '[data-main-menu]').addEventListener(
    'click',
    () => window.dispatchEvent(new Event('ui-main-menu')),
    { signal: screen.signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        ui.current === screen
      ) {
        event.preventDefault();
        launch();
      }
    },
    { capture: true, signal: screen.signal },
  );

  screen.update = update;
  return screen;
};

export default { createDocked };
