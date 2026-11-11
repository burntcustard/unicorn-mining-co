import { powerParts } from './power';
import html from './docked.html?raw';
import './docked.css';
import pentagon from '../icons/corral-5.svg?raw';
import hexagon from '../icons/corral-6.svg?raw';
import { createScreen, focusMenuTarget, nextMenuButton, query, ui } from './ui';
import { player, paintUnlocked, unlockPaint } from '../../player';
import { paintColors } from '../../../specs/colors';
import { type Craft } from '../../objects/craft';
import { type ItemSpec } from '../../../specs/items/types';
import { autogunAmmo } from '../../../specs/items';
import { Module, moduleMaximumHealth } from '../../objects/modules/module';
import { moduleTypes, SearchLight, PowerPlant } from '../../objects/modules';
import { fitsOf, cargoMenuEntriesOf } from '../docked-model';
import {
  applyCraftAction,
  buyAmmo,
  refuelShip,
  removeModule,
  repairHullSegment,
} from '../../network/craft-actions';
import shipPreview from './ship-preview';
import {
  moduleCategories,
  moduleCategoryIds,
} from '../../../specs/modules/categories';
import { icons } from '../icons';
import { type Mount } from '../../types';
import { reconcileRows } from '../../utilities/reconcile-rows';
import { playNavigationSound } from '../../audio/sound-loader';
import { applyHangarAction, hangarState } from '../../network/hangar-actions';
import { Ship } from '../../objects/ship';
import { Item } from '../../objects/item';
import { shipSpecsById, type ShipId } from '../../../specs/ships';
import { Station } from '../../objects/station';
import { moduleTypesById } from '../../objects/modules';

const tabContent = new Map([
  [
    'overview',
    {
      title: 'Station overview',
      description: 'Inspect your ship, trade cargo, or prepare for launch.',
    },
  ],
  [
    'outfitting',
    {
      title: 'Outfitting',
      description: 'Repair your hull and modules, or buy and sell modules.',
    },
  ],
  [
    'trade',
    {
      title: 'Trade',
      description:
        'Sell cargo or buy station stock. Click a row to trade one item.',
    },
  ],
  [
    'hangar',
    {
      title: 'Hangar',
      description:
        'Select an owned ship to manage it, or choose a ship to buy.',
    },
  ],
]);

const buyLabel = (price = 0, label = 'Buy') =>
  player.credits < price ? `${label} (insufficient funds)` : label;

const createDocked = () => {
  const screen = createScreen(html);
  const root = screen.element;
  const preview = shipPreview.createShipPreview(
    query<HTMLCanvasElement>(root, '.dock-preview'),
  );

  const selection = {
    tab: player.ships.length ? 'overview' : 'hangar',
    key: '',
    inspected: '',
    candidate: '',
  };

  let inspectedCandidate = '';
  let inDetails = false;
  let footerOrigin: HTMLElement;
  let previousView = '';
  let structure = '';
  let currentItem: Module | typeof Module | ItemSpec;
  let currentKey = '';
  let hangarPaint = false;
  let dialogShipId = 0;
  let purchaseShipIds: number[] | undefined;
  const saleDialog = query<HTMLDialogElement>(root, '[data-ship-sale-dialog]');
  const renameDialog = query<HTMLDialogElement>(
    root,
    '[data-ship-rename-dialog]',
  );
  const renameInput = query<HTMLInputElement>(root, '#ship-name');
  const showroom = new Map<ShipId, Ship>();

  const showroomShip = (id: ShipId) => {
    let ship = showroom.get(id);

    if (!ship) {
      ship = new Ship({ shipType: id });
      shipSpecsById
        .get(id)
        .initialLoadout.forEach(({ mount, module }) =>
          ship.fit(new (moduleTypesById.get(module))(), ship.mounts[mount]),
        );
      showroom.set(id, ship);
    }

    return ship;
  };

  const selectedHangarShip = () =>
    player.ships.find((ship) => selection.key === `owned:${ship.id}`);
  const saleValues = (ship: Ship): [string, number][] => [
    [
      'Ship',
      shipSpecsById.get((ship.definitionId || 'mustang') as ShipId).price,
    ],
    [
      'Cargo',
      ship.cargoContents.reduce((sum, object) => sum + (object.price || 0), 0),
    ],
    [
      'Modules',
      ship.mounts.reduce(
        (sum, mount) => sum + (mount.module ? mount.module.price : 0),
        0,
      ),
    ],
    [
      'Repairs',
      -ship.repairCost() -
        ship.mounts.reduce((sum, mount) => sum + ship.repairCost(mount), 0),
    ],
    ['Refueling', -ship.refuelCost],
  ];
  const salePrice = (ship: Ship) =>
    saleValues(ship).reduce((sum, [, value]) => sum + value, 0);

  const setKeyboard = (keyboard: boolean) => {
    root.classList.toggle('dock-keyboard', keyboard);
    root.classList.toggle('dock-pointer', !keyboard);
  };

  const text = (selector: string, value: string) => {
    query(root, selector).textContent = value;
  };

  const money = (value: number) => `${value.toLocaleString('en-US')}$`;
  const health = (value: number, maximum: number) =>
    `${Math.floor(value)}/${maximum}`;
  const number = (value: number) => String(value + 1).padStart(2, '0');
  const itemKey = (item: Module | typeof Module) =>
    item instanceof Module ? `owned-${item.id}` : `shop-${item.definitionId}`;
  const tradeKey = (item: Module | ItemSpec) =>
    item instanceof Module ? `module-${item.id}` : `item-${item.resource}`;
  const markup = new WeakMap<HTMLElement, string>();

  const setHtml = (element: HTMLElement, value: string) => {
    if (markup.get(element) !== value) {
      // Replacing focused rows can synchronously trigger another update.
      markup.set(element, value);
      element.innerHTML = value;
    }
  };

  const setRows = (element: HTMLElement, value: string) => {
    if (markup.get(element) === value) return;
    markup.set(element, value);
    reconcileRows(element, value);
  };

  const detail = query(root, '.dock-detail');
  const inspector = query(root, '.dock-inspector');
  const candidateList = query(root, '[data-candidates]');
  const energy = query(root, '.dock-energy');
  const loadout = query(root, '[data-loadout]');
  const detailPreview = query<HTMLCanvasElement>(root, '[data-detail-preview]');
  const launchIcon = query<HTMLCanvasElement>(root, '.dock-launch-icon');
  const buttons = (element: ParentNode = root) =>
    [
      ...element.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled, [aria-disabled="true"])',
      ),
    ].filter((button) => button.getClientRects().length);
  const firstButton = (selector: string) => buttons(query(root, selector))[0];
  const activeTab = () =>
    query<HTMLButtonElement>(root, '[data-tab][aria-current="page"]');
  let detailOrigin: (() => HTMLElement) | undefined;

  const rememberOrigin = (element: HTMLElement) => {
    const group =
      element.closest('[data-trade-items], [data-stock-items], nav') || root;
    const index = buttons(group).indexOf(element as HTMLButtonElement);
    const key = element.getAttribute('data-key');

    detailOrigin = () => {
      const available = buttons(group);

      return (
        available.find((button) =>
          key ? button.getAttribute('data-key') === key : button === element,
        ) ||
        available[Math.min(index, available.length - 1)] ||
        activeTab()
      );
    };
  };

  const drawThumbnails = () => {
    shipPreview.shipThumbnail(launchIcon, player.ship);

    root
      .querySelectorAll<HTMLCanvasElement>('[data-ship-thumbnail]')
      .forEach((element) => {
        const key = element.closest('[data-key]').getAttribute('data-key');
        const ship = key.startsWith('owned:')
          ? player.ships.find((ship) => key === `owned:${ship.id}`)
          : showroom.get(key.slice('offer:'.length) as ShipId);

        if (ship) shipPreview.shipThumbnail(element, ship);
      });

    loadout
      .querySelectorAll<HTMLCanvasElement>('[data-hull]')
      .forEach((element) =>
        preview.thumbnail(element, Number(element.getAttribute('data-hull')), {
          outline: true,
        }),
      );

    const [kind, index] = selection.key.split(':');

    if (selection.tab === 'trade' && currentItem) {
      preview.clearThumbnail(detailPreview);
      shipPreview.itemThumbnail(
        detailPreview,
        currentItem as Module | ItemSpec,
      );
    } else if (kind === 'hull') {
      preview.thumbnail(detailPreview, Number(index));
    }
  };

  const thumbnailObserver = new ResizeObserver(drawThumbnails);

  thumbnailObserver.observe(loadout);
  thumbnailObserver.observe(detailPreview);
  thumbnailObserver.observe(launchIcon);
  thumbnailObserver.observe(query(root, '[data-hangar]'));

  const moduleRow = ({ mount, index }: { mount: Mount; index: number }) => {
    const module = mount.module;
    const color = module ? moduleCategories.get(module.category).color : '#bbc';
    const icon = icons.get(module ? module.icon : './empty.svg');
    const condition = module
      ? `<small class="dock-row-text ml-auto">${health(mount.health, moduleMaximumHealth(module))}</small>`
      : '';

    return `<button class="ui-button dock-row flex items-center gap-2${module ? '' : ' dock-empty'}" data-key="mount:${index}" style="--ui-color:${color}">
      <span>${icon}</span><span class="dock-row-text">${module ? module.name : 'Empty slot'}</span>${condition}
    </button>`;
  };

  const hullRow = ({
    index,
    current,
    maximum,
    modules,
  }: {
    index: number;
    current: number;
    maximum: number;
    modules: string;
  }) => `<div class="dock-group mb-2">
    <button class="ui-button dock-row flex items-center gap-2" data-key="hull:${index}">
      <canvas data-hull="${index}" aria-hidden="true"></canvas>
      <span class="dock-row-text">Hull ${number(index)}</span>
      <small class="dock-row-text ml-auto">${health(current, maximum)}</small>
    </button>${modules}
  </div>`;

  const actions = [
    ...root.querySelectorAll<HTMLButtonElement>('[data-command]'),
  ];

  query(root, '.dock-energy-legend').innerHTML = [...moduleCategories.values()]
    .map(({ name, color }) => `<span style="color:${color}">${name}</span>`)
    .join('');

  const swatches = paintColors.map((shades, index) => {
    const element = document.createElement('button');

    element.innerHTML = '<span></span>';
    element.className = 'ui-button';
    element.style.setProperty('--paint', shades[2]);
    element.setAttribute(
      'aria-label',
      ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Violet', 'White', 'Gray'][
        index
      ] + ' paint',
    );
    element.setAttribute('data-paint', String(index));
    query(root, '[data-paints]').append(element);
    return element;
  });

  const updateHangar = (station: Craft) => {
    const offers =
      hangarState.shipsForSale ||
      (station instanceof Station ? station.shipsForSale : []);
    const owned = selectedHangarShip();
    const mustangOffer = offers.find((entry) => entry.ship === 'mustang');
    const special =
      mustangOffer &&
      player.credits < mustangOffer.price &&
      player.ships.reduce(
        (sum, ship) => sum + salePrice(ship),
        player.credits,
      ) < mustangOffer.price;
    const offer = offers.find(
      (entry) => selection.key === `offer:${entry.ship}`,
    );
    let ship = owned;

    if (offer) ship = showroomShip(offer.ship);

    const rows = (entries: { key: string; ship: Ship; label: string }[]) =>
      entries
        .map(({ key, ship, label }) => {
          const name = document.createElement('span');

          name.className = 'dock-row-text';
          name.textContent = ship.name;
          return `<button class="ui-button dock-row flex items-center gap-2" data-key="${key}" aria-pressed="${selection.key === key}">
          <canvas data-ship-thumbnail aria-hidden="true"></canvas>${name.outerHTML}<small class="dock-row-text ml-auto">${label}</small>
        </button>`;
        })
        .join('');

    setRows(
      query(root, '[data-owned-ships]'),
      player.ships.length
        ? `<div class="dock-group uppercase text-sm">${rows(
            player.ships.map((ship) => ({
              key: `owned:${ship.id}`,
              ship,
              label: ship.id === player.ship.id ? 'PILOTING' : '',
            })),
          )}</div>`
        : '<p class="text-muted mt-4">You do not own any ships.</p>',
    );

    setRows(
      query(root, '[data-ships-for-sale]'),
      offers
        .map((offer) => {
          const name = shipSpecsById.get(offer.ship).name;

          showroomShip(offer.ship);

          return `<button class="ui-button dock-row flex items-center gap-2" data-key="offer:${offer.ship}" aria-pressed="${selection.key === `offer:${offer.ship}`}">
        <canvas data-ship-thumbnail aria-hidden="true"></canvas><span class="dock-row-text">${name}</span>${special && offer.ship === 'mustang' ? '<span class="dock-row-text ml-auto"><span class="dock-offer">SPECIAL OFFER</span>!</span>' : `<small class="dock-row-text ml-auto">${money(offer.price)}</small>`}
      </button>`;
        })
        .join(''),
    );

    detail.hidden = false;
    detail.style.setProperty('--ui-color', '#eef');
    text('[data-location]', ship ? (owned ? 'Your ships' : station.name) : '');
    query(root, '[data-location]').parentElement.hidden = !ship;
    text(
      '[data-category]',
      ship
        ? shipSpecsById.get((ship.definitionId || 'mustang') as ShipId).name
        : '',
    );
    text('[data-title]', ship?.name || 'Hangar');
    query(root, '[data-title]').hidden = false;
    text(
      '[data-description]',
      ship
        ? owned
          ? ship.id === player.ship.id
            ? 'Currently piloting this ship.'
            : 'Available to pilot at any station.'
          : ''
        : tabContent.get('hangar').description,
    );
    query(root, '[data-description]').hidden = Boolean(offer);
    text('[data-hangar-status]', hangarState.error);
    query(root, '[data-hangar-status]').hidden = !hangarState.error;
    query(root, '[data-hangar-stats]').hidden = !ship;
    setHtml(
      query(root, '[data-hangar-stats]'),
      ship
        ? `<dt>Hull</dt><dd>${health(ship.hullHealthTotal, ship.hullMaxHealth)}</dd>
        <dt>Modules fitted</dt><dd>${ship.mounts.filter((mount) => mount.module).length}/${ship.mounts.length}</dd>
        <dt>Cargo</dt><dd>${ship.cargoContents.length}/${ship.cargoSpace}</dd>
        <dt>Fuel</dt><dd>${ship.fuel.toFixed(1)}/${ship.fuelCapacity} L</dd>`
        : '',
    );

    [
      '[data-detail-preview]',
      '[data-health-panel]',
      '[data-candidate-panel]',
      '[data-module-power]',
      '[data-fuel-usage]',
      '[data-trade-price-panel]',
      '[data-actions]',
    ].forEach((selector) => {
      query(root, selector).hidden = true;
    });

    const total = owned
      ? owned.repairCost() +
        owned.mounts.reduce((sum, mount) => sum + owned.repairCost(mount), 0)
      : 0;

    query(root, '[data-hangar-actions]').hidden = !ship;

    root
      .querySelectorAll<HTMLButtonElement>('[data-hangar-command]')
      .forEach((button) => {
        const command = button.getAttribute('data-hangar-command');

        button.hidden =
          command === 'SPECIAL'
            ? !special || offer?.ship !== 'mustang'
            : command === 'BUY'
              ? !offer
              : !owned || (command === 'PILOT' && owned.id === player.ship.id);
        button.disabled =
          hangarState.busy ||
          (command === 'BUY' && player.credits < offer?.price) ||
          (command === 'REPAIR' && (!total || player.credits < total)) ||
          (command === 'REFUEL' &&
            (!owned?.refuelCost || player.credits < owned.refuelCost));
      });

    text('[data-ship-buy-label]', buyLabel(offer?.price));
    query(root, '[data-special-offer]').hidden =
      !special || offer?.ship !== 'mustang';
    text(
      '[data-special-offer]',
      `This offer allows you to rebuy a mustang with new modules, however it costs your remaining unicredits (${player.credits.toLocaleString('en-US')}) and will automatically sell any items and ships you currently own.`,
    );
    text('[data-ship-price]', money(offer?.price || 0));
    text('[data-ship-repair]', money(total));
    text('[data-ship-refuel]', money(owned?.refuelCost || 0));
    text('[data-ship-sale]', `+${money(owned ? salePrice(owned) : 0)}`);
    query(root, '[data-paint-panel]').hidden = !owned || !hangarPaint;
    query(root, '[data-paint-heading]').hidden = false;
    text('[data-paint-heading]', 'Hull paint');
    query(root, '[data-paint-unsupported]').hidden = true;
    query(root, '[data-paints]').hidden = false;

    swatches.forEach((button, index) => {
      button.disabled = hangarState.busy || !paintUnlocked(paintColors[index]);
      button.setAttribute(
        'aria-pressed',
        String(owned?.shades === paintColors[index]),
      );
    });

    query(root, '.dock-center').hidden = !ship;
    energy.hidden = true;
    query(root, '[data-fitting-preview]').hidden = true;

    if (ship) {
      preview.update(ship, {
        hull: -1,
        mount: -1,
        active: offer ? 'all' : false,
      });
    }

    drawThumbnails();
  };

  const update = () => {
    const ship = player.ship;
    const mounts = ship.mounts;
    const hullHealth = ship.hullHealth;
    const station = ship.world?.entities.get(ship.dockedTo) as
      | Craft
      | undefined;

    if (!station) return;

    const purchased = purchaseShipIds
      ? player.ships.find((owned) => !purchaseShipIds.includes(owned.id))
      : undefined;

    if (purchased || hangarState.error) purchaseShipIds = undefined;

    if (purchased && selection.tab === 'hangar') {
      selection.key = selection.inspected = `owned:${purchased.id}`;
      hangarPaint = false;
      inDetails = true;
      detailOrigin = () =>
        root.querySelector<HTMLElement>(`[data-key="owned:${purchased.id}"]`);
    }

    if (
      selection.tab === 'hangar' &&
      selection.key.startsWith('owned:') &&
      !selectedHangarShip()
    ) {
      selection.key = selection.inspected = '';
      inDetails = false;
      hangarPaint = false;
    }

    const trading = selection.tab === 'trade';
    const cargo = cargoMenuEntriesOf(ship);
    const stock = cargoMenuEntriesOf(station);

    if (trading) {
      const keys = [
        ...cargo.map(([entry]) => `cargo:${tradeKey(entry)}`),
        ...stock.map(([entry]) => `shop:${tradeKey(entry)}`),
      ];

      if (selection.key && !keys.includes(selection.key)) {
        selection.key = '';
        inDetails = false;
      }

      if (selection.inspected && !keys.includes(selection.inspected)) {
        selection.inspected = '';
        inDetails = false;
      }
    }

    const view = JSON.stringify([
      selection,
      ship.definitionId,
      ship.name,
      inspectedCandidate,
      inDetails,
      hullHealth,
      ship.fuel,
      ship.moduleStates,
      ship.cargoContents.map((object) => [object.id, object.health]),
      player.credits,
      player.unlockedPaints,
      ship.shades,
      station.definitionId,
      station.name,
      station.moduleStates,
      station.cargoContents.map((object) => [object.id, object.health]),
      player.ships.map((owned) => [
        owned.id,
        owned.name,
        owned.hullHealth,
        owned.fuel,
        owned.shades,
        owned.moduleStates,
        owned.cargoContents.map((object) => [object.id, object.price]),
      ]),
      hangarState,
      hangarPaint,
    ]);

    if (previousView === view) return;
    const focused = root.querySelector<HTMLButtonElement>('button:focus');
    const focusGroup =
      focused?.closest('[data-trade-items]') ||
      focused?.closest(
        '[data-trade-items], [data-stock-items], nav, [data-action-group]',
      ) ||
      inspector;
    const focusIndex = focused ? buttons(focusGroup).indexOf(focused) : -1;
    const focusKey = focused?.getAttribute('data-key');

    previousView = view;
    text('[data-back-label]', inDetails || selection.key ? 'Back' : 'Launch');
    query<HTMLButtonElement>(root, '[data-launch]').disabled =
      !player.ships.length && !inDetails && !selection.key;
    launchIcon.hidden =
      !player.ships.length || Boolean(inDetails || selection.key);
    query(root, '[data-launch-unavailable]').hidden = !query<HTMLButtonElement>(
      root,
      '[data-launch]',
    ).disabled;

    const hullIndexOf = (mountIndex: number) =>
      ship.hullSegments.indexOf(mounts[mountIndex]?.hull.module);

    currentKey = trading ? selection.inspected || selection.key : selection.key;
    const [kind, indexText] = currentKey.split(':');
    const index = Number(indexText);
    const mount = kind === 'mount' ? mounts[index] : undefined;
    const hullIndex = kind === 'hull' ? index : mount ? hullIndexOf(index) : -1;
    const candidates = mount && !mount.module ? fitsOf(ship, mount) : [];

    const selectedCandidate = candidates.find(
      (item) => itemKey(item) === selection.candidate,
    );

    if (mount && !mount.module && selection.candidate && !selectedCandidate) {
      back();
      return;
    }

    let item: any = mount?.module || selectedCandidate;

    const tradeEntry = (kind === 'cargo' ? cargo : stock).find(
      ([entry]) => tradeKey(entry) === indexText,
    );

    detail.hidden = Boolean(mount && !mount.module && !selectedCandidate);

    if (trading) item = tradeEntry?.[0];
    currentItem = item;
    const module =
      item && (item instanceof Module || typeof item === 'function')
        ? item
        : undefined;
    const color = moduleCategories.get(module?.category)?.color || '#eef';

    detail.style.setProperty('--ui-color', color);

    const stationName = station.name;

    text('[data-station]', stationName);
    setHtml(
      query(root, '.dock-station-icon'),
      station.definitionId === 'corral-6' ? hexagon : pentagon,
    );
    text('[data-fuel]', `${ship.fuel.toFixed(1)}/${ship.fuelCapacity} L`);
    text('[data-fuel-price]', money(ship.refuelCost));
    query<HTMLButtonElement>(root, '[data-refuel]').disabled =
      !player.ships.length ||
      !ship.refuelCost ||
      player.credits < ship.refuelCost;
    text('[data-balance]', money(player.credits));
    text('[data-ship-name]', ship.name);
    const repairTotal =
      ship.repairCost() +
      mounts.reduce((sum, entry) => sum + ship.repairCost(entry), 0);

    text('[data-repair-total]', money(repairTotal));
    query<HTMLButtonElement>(root, '[data-repair-all]').disabled =
      !player.ships.length || !repairTotal || player.credits < repairTotal;
    query<HTMLButtonElement>(root, '[data-hull-paint]').disabled =
      !player.ships.length;

    for (const selector of ['[data-overview]', '[data-outfitting]']) {
      for (const element of query(root, selector).children) {
        (element as HTMLElement).hidden = element.hasAttribute(
          'data-ship-required',
        )
          ? Boolean(player.ships.length)
          : !player.ships.length;
      }
    }

    query(root, '[data-market-disabled]').hidden =
      !trading || Boolean(player.ships.length);
    query(root, '[data-purchase-ship]').hidden =
      selection.tab !== 'outfitting' || Boolean(player.ships.length);
    text(
      '[data-cargo-total]',
      `${ship.cargoContents.length}/${ship.cargoSpace}`,
    );
    text('[data-hull-total]', health(ship.hullHealthTotal, ship.hullMaxHealth));
    text(
      '[data-module-count]',
      `${mounts.filter((entry) => entry.module).length}/${mounts.length}`,
    );

    root
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((element) => {
        if (element.getAttribute('data-tab') === selection.tab) {
          element.setAttribute('aria-current', 'page');
        } else {
          element.removeAttribute('aria-current');
        }
      });

    query(root, '.dock-summary').hidden =
      !player.ships.length || trading || selection.tab === 'hangar';
    query(root, '.dock-center').hidden = !player.ships.length || trading;
    query(root, '[data-trade-stock]').hidden = !trading;

    ['overview', 'outfitting', 'trade', 'hangar'].forEach((tab) => {
      query(root, `[data-${tab}]`).hidden = tab !== selection.tab;
    });

    query(root, '[data-hangar-actions]').hidden = true;
    query(root, '[data-hangar-stats]').hidden = true;
    query(root, '[data-hangar-status]').hidden = true;
    energy.hidden = false;
    text('[data-paint-heading]', 'Module paint');
    root.classList.toggle('dock-hangar', selection.tab === 'hangar');

    if (selection.tab === 'hangar') {
      updateHangar(station);

      if (purchased) {
        (buttons(detail)[0] || detail).focus();
      } else if (
        focused &&
        (!focused.isConnected ||
          focused.disabled ||
          !focused.getClientRects().length)
      ) {
        const available = buttons(focusGroup);

        (
          available[Math.min(Math.max(focusIndex, 0), available.length - 1)] ||
          detailOrigin?.() ||
          activeTab()
        ).focus();
      }

      return;
    }

    const nextStructure = JSON.stringify([
      hullHealth,
      mounts.map((entry) => [entry.module && entry.module.id, entry.health]),
    ]);

    if (structure !== nextStructure) {
      structure = nextStructure;

      setRows(
        loadout,
        ship.hullSegments
          .map((plan, hull) =>
            hullRow({
              index: hull,
              current: hullHealth[hull],
              maximum: plan.health,
              modules: mounts
                .flatMap((mount, index) =>
                  hullIndexOf(index) === hull
                    ? [moduleRow({ mount, index })]
                    : [],
                )
                .join(''),
            }),
          )
          .join(''),
      );
    }

    root
      .querySelectorAll('[data-loadout] [data-key]')
      .forEach((element) =>
        element.setAttribute(
          'aria-pressed',
          String(element.getAttribute('data-key') === selection.key),
        ),
      );
    setRows(
      candidateList,
      candidates
        .map(
          (entry) =>
            `<button class="ui-button dock-row flex items-center gap-2" data-key="${itemKey(entry)}"
            style="--ui-color:${moduleCategories.get(entry.category).color}">
            <span>${icons.get(entry.icon)}</span><span class="dock-row-text">${entry.name}</span>
            <small class="dock-row-text ml-auto">${entry instanceof Module ? 'IN CARGO' : money(entry.price)}</small>
          </button>`,
        )
        .join(''),
    );
    candidateList
      .querySelectorAll('button')
      .forEach((element) =>
        element.setAttribute(
          'aria-pressed',
          String(element.getAttribute('data-key') === selection.candidate),
        ),
      );

    const tradeRows = (entries: typeof cargo, kind: 'cargo' | 'shop') =>
      entries
        .map(
          ([entry, count]) =>
            `<button class="ui-button dock-row dock-trade-row" ${!player.ships.length ? 'disabled' : ''} data-key="${kind}:${tradeKey(entry)}"
              style="--ui-color:${entry instanceof Module ? moduleCategories.get(entry.category).color : '#eef'}"
              aria-disabled="${!player.ships.length || (kind === 'shop' && (ship.cargoContents.length >= ship.cargoSpace || player.credits < entry.price))}"
              aria-label="${kind === 'cargo' ? 'Sell' : buyLabel(entry.price)} one ${entry.name} for ${money(entry.price || 0)}, supply ${count}">
              <span class="px-3 dock-trade-name flex gap-2" data-trade-action="${kind === 'cargo' ? 'SELL' : buyLabel(entry.price, 'BUY')}"><span class="dock-row-text">${entry.name}</span></span>
              <small class="px-3 text-right dock-trade-supply grid" aria-hidden="true"><span class="dock-row-text">${count.toLocaleString('en-US')}</span></small>
              <small class="px-3 text-right dock-trade-price grid" aria-hidden="true"><span class="dock-row-text">${money(entry.price || 0)}</span></small>
            </button>`,
        )
        .join('');

    const tradeTables = (entries: typeof cargo, kind: 'cargo' | 'shop') =>
      (
        [
          [
            'Items',
            entries.filter(
              ([entry]) => !(entry instanceof Module) && !entry.rounds,
            ),
          ],
          ['Modules', entries.filter(([entry]) => entry instanceof Module)],
          [
            'Ammunition',
            entries.filter(
              ([entry]) => !(entry instanceof Module) && entry.rounds,
            ),
          ],
        ] as const
      )
        .filter(([, entries]) => entries.length)
        .map(
          ([name, entries]) =>
            `<div class="dock-trade-table grid uppercase text-sm" data-trade-group="${name.toLowerCase()}">
              <div class="dock-trade-heading text-muted">
                <h3 class="px-3">${name}</h3><span class="px-3 text-right">Supply</span><span class="px-3 text-right">${kind === 'cargo' ? 'Sell' : 'Buy'}</span>
              </div>
              <div class="dock-group">${tradeRows(entries, kind)}</div>
            </div>`,
        )
        .join('');

    setRows(
      query(root, '[data-trade-items]'),
      cargo.length
        ? tradeTables(cargo, 'cargo')
        : '<p class="text-muted mt-4">No cargo to sell.</p>',
    );
    setRows(
      query(root, '[data-stock-items]'),
      stock.length
        ? tradeTables(stock, 'shop')
        : '<p class="text-muted mt-4">No stock available.</p>',
    );

    const paintHull = selection.key === 'paint';

    query(root, '[data-hull-paint]').setAttribute(
      'aria-pressed',
      String(paintHull),
    );
    const overview = !currentKey || (trading && !item);

    text(
      '[data-location]',
      item && (trading || selectedCandidate)
        ? kind === 'cargo' || selectedCandidate instanceof Module
          ? 'Cargo'
          : stationName
        : hullIndex >= 0
          ? `Hull ${number(hullIndex)}`
          : '',
    );
    text(
      '[data-category]',
      moduleCategories.get(module?.category)?.name || (item ? 'Item' : ''),
    );
    const heading = query(root, '[data-location]').parentElement;

    heading.hidden = !heading.textContent.trim();
    text(
      '[data-title]',
      paintHull
        ? 'Hull paint'
        : module
          ? selection.tab === 'outfitting' && module.ammo
            ? `${module.name} (AMMO:${ship.cargoContents.reduce(
                (sum, entry) =>
                  entry instanceof Item &&
                  entry.resource === module.ammo.resource
                    ? sum + (entry.rounds || 0)
                    : sum,
                0,
              )})`
            : module.name
          : item
            ? item.name
            : kind === 'hull'
              ? ''
              : overview
                ? tabContent.get(selection.tab).title
                : 'Empty slot',
    );
    query(root, '[data-title]').hidden = !query(root, '[data-title]')
      .textContent;
    text(
      '[data-description]',
      !player.ships.length && selection.tab === 'outfitting'
        ? 'No ship to outfit.'
        : paintHull
          ? 'Choose a color for the entire hull.'
          : item
            ? item.description || ''
            : kind === 'hull'
              ? ''
              : overview
                ? tabContent.get(selection.tab).description
                : 'Fit a compatible module from cargo or buy one from the station.',
    );
    query(root, '[data-description]').hidden = !query(
      root,
      '[data-description]',
    ).textContent;
    query(root, '[data-detail-preview]').hidden =
      kind !== 'hull' && !(trading && item);
    query(root, '[data-candidate-panel]').hidden = !candidates.length;
    const maximum =
      kind === 'hull'
        ? ship.hullSegments[index].health
        : module
          ? moduleMaximumHealth(module)
          : 0;
    const currentHealth =
      kind === 'hull'
        ? hullHealth[index]
        : mount?.module
          ? mount.health
          : item instanceof Module
            ? item.health ||
              ((item.constructor as typeof Module).health === 0
                ? item.healthActivated
                : 0)
            : maximum;

    query(root, '[data-health-panel]').hidden = trading || !maximum;
    text('[data-health]', health(currentHealth || 0, maximum));
    const repairCost =
      kind === 'hull'
        ? maximum - Math.floor(currentHealth)
        : mount?.module
          ? ship.repairCost(mount)
          : 0;

    setHtml(
      query(root, '[data-module-power]'),
      module && !trading
        ? module.powerGenerated
          ? `<h3 class="text-sm uppercase">Generation</h3><div class="text-color text-lg mt-4">${module.powerGenerated.toFixed(1)} MW</div><h3 class="text-sm uppercase mt-4">Storage</h3><div class="text-color text-lg mt-4">${(module.powerCapacity || 0).toFixed(1)} MJ</div>`
          : `<h3 class="text-sm uppercase">Power consumption</h3><div class="flex items-center gap-12 mt-4"><div><span class="block text-muted text-sm uppercase">Idle</span><span class="text-color text-lg">${module.power.toFixed(1)} MW</span></div><div><span class="block text-muted text-sm uppercase">Active</span><span class="text-color text-lg">${module.powerActivated.toFixed(1)} MW</span></div>${module.powerFiring ? `<div><span class="block text-muted text-sm uppercase">Firing</span><span class="text-color text-lg">${module.powerFiring.toFixed(1)} MW</span></div>` : ''}${module.powerCharging ? `<div><span class="block text-muted text-sm uppercase">Charging</span><span class="text-color text-lg">${module.powerCharging.toFixed(1)} MW</span></div>` : ''}</div>`
        : '',
    );
    query(root, '[data-module-power]').hidden = !module || trading;
    text(
      '[data-fuel-usage]',
      module?.fuelUsage
        ? `Fuel usage: ${(module.fuelUsage * 60).toFixed(1)} L/min`
        : '',
    );
    query(root, '[data-fuel-usage]').hidden = !module?.fuelUsage;
    const owned = item instanceof Module;
    const ammo = module?.ammo === autogunAmmo ? autogunAmmo : undefined;
    const equipped = Boolean(mount?.module);
    const hasSpace = ship.cargoContents.length < ship.cargoSpace;
    const available = trading
      ? []
      : [
          ...(kind === 'hull' || equipped ? ['FIX'] : []),
          ...(equipped ? ['REMOVE'] : []),
          ...(owned || kind === 'cargo' ? ['SELL'] : []),
          ...(owned && ammo ? ['BUY_AMMO'] : []),
          ...(item && !owned && kind !== 'cargo' ? ['BUY'] : []),
          ...(owned && mount && !equipped ? ['EQUIP'] : []),
        ];

    query(root, '[data-actions]').hidden = !available.length;

    actions.forEach((element) => {
      const action = element.getAttribute('data-command');

      element.hidden = !available.includes(action);
      element.disabled =
        action === 'FIX'
          ? !repairCost || player.credits < repairCost
          : action === 'BUY' || action === 'BUY_AMMO'
            ? (!hasSpace && (action === 'BUY_AMMO' || !mount || equipped)) ||
              (action === 'BUY_AMMO' &&
                !stock.some(([entry]) => entry === ammo)) ||
              player.credits <
                (action === 'BUY_AMMO' ? ammo?.price : item?.price)
            : action === 'REMOVE'
              ? !hasSpace
              : false;
    });

    text('[data-repair]', money(repairCost));
    text('[data-buy-label]', buyLabel(item?.price));
    text('[data-buy-ammo-label]', buyLabel(ammo?.price, 'Buy ammo'));
    text('[data-price]', money(item?.price || 0));
    text('[data-ammo-price]', money(ammo?.price || 0));
    text('[data-sale]', `+${money(item?.price || 0)}`);
    query(root, '[data-trade-price-panel]').hidden = !trading || !item;
    text(
      '[data-trade-price-label]',
      kind === 'cargo' ? 'Sell price' : 'Buy price',
    );
    text('[data-trade-value]', money(item?.price || 0));
    query(root, '[data-paint-panel]').hidden =
      trading || (!paintHull && !owned);
    query(root, '[data-paint-heading]').hidden = paintHull;
    const paintUnsupported =
      module instanceof SearchLight || module instanceof PowerPlant;

    query(root, '[data-paint-unsupported]').hidden = !paintUnsupported;
    query(root, '[data-paints]').hidden = paintUnsupported;
    query(root, '[data-paints]').className =
      `dock-paints${paintHull ? '' : ' mt-4'}`;

    swatches.forEach((element, at) => {
      element.disabled = !paintUnlocked(paintColors[at]);
      element.setAttribute(
        'aria-pressed',
        String((paintHull ? ship : item)?.shades?.[2] === paintColors[at][2]),
      );
    });

    const [previewKind, previewIndexText] = selection.inspected.split(':');
    const previewIndex = Number(previewIndexText);
    const previewMount =
      previewKind === 'mount' ? mounts[previewIndex] : undefined;
    const previewHull =
      previewKind === 'hull'
        ? previewIndex
        : previewMount
          ? hullIndexOf(previewIndex)
          : -1;
    const previewCandidate =
      selection.inspected === selection.key
        ? candidates.find((item) => itemKey(item) === inspectedCandidate) ||
          selectedCandidate
        : undefined;
    const consumers = mounts.flatMap((entry, at) =>
      entry.module ? [{ module: entry.module, at }] : [],
    );

    if (previewCandidate) {
      consumers.push({ module: previewCandidate as Module, at: index });
    }

    consumers.sort(
      (a, b) =>
        moduleCategoryIds.indexOf(a.module.category) -
        moduleCategoryIds.indexOf(b.module.category),
    );
    const idle = consumers.reduce((sum, entry) => sum + entry.module.power, 0);
    const active = consumers.reduce(
      (sum, entry) =>
        sum +
        Math.max(entry.module.powerActivated, entry.module.powerFiring || 0),
      0,
    );
    const output = consumers.reduce(
      (sum, entry) => sum + (entry.module.powerGenerated || 0),
      0,
    );
    const scale = Math.max(active, output, 1);

    const powerBar = ({
      label,
      total,
      active = false,
    }: {
      label: string;
      total: number;
      active?: boolean;
    }) => {
      const parts = powerParts({
        scale,
        entries: consumers.map(({ module, at }) => ({
          module,
          value: active
            ? Math.max(module.powerActivated, module.powerFiring || 0)
            : module.power,
          highlighted:
            previewHull < 0 ||
            (previewMount
              ? at === previewIndex
              : hullIndexOf(at) === previewHull),
        })),
      });

      const generation = output
        ? `<span class="ui-power-marker" title="Output: ${output.toFixed(1)} MW"
            style="left:${(output / scale) * 100}%"></span>`
        : '';

      return `<div class="dock-power-label flex items-center justify-between gap-3 mt-4 mb-2">
        <span class="uppercase">${label}</span><span>${total.toFixed(1)} MW</span>
      </div><div class="ui-power-track">${parts}${generation}</div>`;
    };

    query(root, '[data-fitting-preview]').hidden = !previewCandidate;
    text('[data-generation]', `${output.toFixed(1)} MW`);
    text('[data-output]', `Output ${output.toFixed(1)} MW`);

    energy.classList.toggle('dock-inspecting', previewHull >= 0);
    energy.classList.toggle(
      'dock-inspecting-generator',
      previewHull >= 0 &&
        Boolean(
          previewCandidate?.powerGenerated ||
          (previewMount?.module && previewMount.module.powerGenerated),
        ),
    );

    setRows(
      query(root, '[data-power-bars]'),
      powerBar({ label: 'Idle', total: idle }) +
        powerBar({
          label: 'Active',
          total: active,
          active: true,
        }),
    );

    preview.update(ship, {
      hull: previewHull,
      mount: previewMount ? previewIndex : -1,
      candidate: previewCandidate,
    });

    drawThumbnails();

    if (
      focused &&
      (!focused.isConnected ||
        focused.disabled ||
        !focused.getClientRects().length)
    ) {
      const available = buttons(focusGroup);
      const replacement =
        (mount && !mount.module && !selectedCandidate
          ? candidates.length
            ? buttons(candidateList)[0] || candidateList
            : detailOrigin?.()
          : undefined) ||
        available.find(
          (button) => focusKey && button.getAttribute('data-key') === focusKey,
        ) ||
        available.find(
          (button) =>
            selection.candidate &&
            button.getAttribute('data-key') === selection.candidate,
        ) ||
        available[Math.min(Math.max(focusIndex, 0), available.length - 1)] ||
        detailOrigin?.() ||
        activeTab();

      replacement.focus();
    }

    if (trading && !inDetails && !selection.key) detailOrigin = undefined;
  };

  const open = (tab: string) => {
    hangarPaint = false;
    inDetails = false;
    footerOrigin = undefined;
    detailOrigin = undefined;
    selection.tab = tab;
    selection.key = selection.inspected = selection.candidate = '';
    inspectedCandidate = '';

    update();
  };

  const inspect = (element: HTMLElement) => {
    const key = element.getAttribute('data-key');

    if (!key) return;

    if (selection.tab === 'hangar') return;

    if (element.closest('[data-candidates]')) {
      inspectedCandidate = key;
    } else {
      inDetails = false;
      selection.inspected = key;
      inspectedCandidate = '';
    }

    update();
  };

  const selectRow = ({
    element,
    event,
  }: {
    element: HTMLElement;
    event: PointerEvent | KeyboardEvent;
  }) => {
    if (event.isTrusted) playNavigationSound('select');

    const key = element.getAttribute('data-key');

    if (selection.tab === 'hangar' && key !== selection.key) {
      hangarPaint = false;
    }

    const candidate = element.closest('[data-candidates]');

    if (candidate) {
      selection.candidate = key;
    } else {
      rememberOrigin(element);
      selection.key = key;
      selection.candidate = '';
    }

    inspect(element);
    inDetails = true;
    update();

    if (!candidate || event instanceof KeyboardEvent) {
      (key.startsWith('mount:') && !currentItem
        ? candidateList.getClientRects().length
          ? buttons(candidateList)[0] || candidateList
          : element
        : buttons(detail)[0] || detail
      ).focus();
    }

    if (candidate) detail.scrollTop = 0;
  };

  const launch = () => {
    if (!player.ships.length) {
      query<HTMLDialogElement>(
        root,
        '[data-launch-unavailable-dialog]',
      ).showModal();
      return;
    }

    player.ship.launchRequested = 1;
    ui.clear();
  };

  const back = () => {
    const dialog = root.querySelector<HTMLDialogElement>('dialog[open]');

    if (dialog) {
      dialog.close();
      return;
    }

    if (!inDetails && !selection.key) return launch();
    playNavigationSound('unselect');
    inDetails = false;
    const row =
      detailOrigin?.() ||
      root.querySelector<HTMLElement>(
        `[data-key="${selection.key || selection.inspected}"]`,
      );

    selection.key = selection.candidate = '';
    hangarPaint = false;
    inspectedCandidate = '';
    detailOrigin = undefined;
    selection.inspected = row?.getAttribute('data-key') || '';
    (
      row ||
      (selection.tab === 'hangar'
        ? activeTab()
        : query<HTMLElement>(root, '[data-hull-paint]'))
    ).focus();
    update();
  };

  const repairAll = () => {
    const ship = player.ship;
    const total =
      ship.repairCost() +
      ship.mounts.reduce((sum, mount) => sum + ship.repairCost(mount), 0);

    if (player.credits < total) return;
    applyCraftAction(ship, { action: 'repair' });

    ship.mounts.forEach((mount, index) => {
      if (mount.module) {
        applyCraftAction(ship, {
          action: 'repair',
          mount: index,
          moduleId: mount.module.id,
        });
      }
    });
  };

  const validateShipName = () => {
    const name = renameInput.value.trim();
    const valid =
      Array.from(name).length > 0 &&
      Array.from(name).length <= 16 &&
      !Array.from(name).some(
        (character) =>
          character.codePointAt(0) < 32 ||
          (character.codePointAt(0) >= 127 && character.codePointAt(0) <= 159),
      );

    renameInput.setCustomValidity(
      valid
        ? ''
        : 'Use a name from 1 to 16 characters, without control characters.',
    );
    return valid;
  };

  renameInput.addEventListener('input', validateShipName, {
    signal: screen.signal,
  });

  query<HTMLFormElement>(root, '[data-ship-rename-form]').addEventListener(
    'submit',
    (event) => {
      event.preventDefault();

      if (!validateShipName()) {
        renameInput.reportValidity();
        return;
      }

      applyHangarAction('RENAME', dialogShipId, renameInput.value.trim());
      renameDialog.close();
      update();
    },
    { signal: screen.signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        ui.current !== screen ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.querySelector('dialog[open]')
      ) {
        return;
      }

      const focused = root.querySelector<HTMLElement>(':focus');
      const horizontal =
        event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';

      if (horizontal || vertical || ['Tab', 'Enter', ' '].includes(event.key)) {
        setKeyboard(true);
      }

      if (event.key === 'Tab') {
        ui.element.classList.remove('ui-arrow-navigation');
        const available = buttons();
        const index = available.indexOf(focused as HTMLButtonElement);

        if (
          index < 0 ||
          (event.shiftKey ? index === 0 : index === available.length - 1)
        ) {
          event.preventDefault();
          (focused === detail || focused === candidateList
            ? event.shiftKey
              ? buttons(query(root, '[data-trade-stock]')).at(-1) ||
                buttons(loadout).at(-1)
              : buttons(inspector)[0] || firstButton('.dock-footer')
            : event.shiftKey
              ? available.at(-1)
              : available[0]
          )?.focus();
        }

        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
        event.preventDefault();
        return;
      }

      if (!horizontal && !vertical) return;
      event.preventDefault();
      ui.element.classList.add('ui-arrow-navigation');

      if (!focused) {
        focusMenuTarget(activeTab(), event.key);
        return;
      }

      const direction =
        event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const inTabs = focused.closest('.ui-tabs');
      const inSummary = focused.closest('.dock-summary');
      const inDetail = focused.closest('.dock-detail');
      const inPaints = focused.closest('[data-paints]');
      const inCandidates = focused.closest('[data-candidates]');
      const footer = firstButton('.dock-footer');
      const firstContent = () =>
        firstButton('[data-sidebar]') ||
        firstButton('[data-trade-stock]') ||
        footer;
      let target: HTMLElement;

      if (inDetail) {
        if (horizontal) {
          target = inPaints
            ? nextMenuButton({ group: inPaints, direction })
            : focused;
        } else {
          const paint = inPaints ? focused : firstButton('[data-paints]');

          target =
            nextMenuButton({
              group: inDetail,
              direction,
              filter: (button) =>
                !button.hasAttribute('data-paint') || button === paint,
            }) || focused;
        }
      } else if (vertical && inCandidates) {
        target = nextMenuButton({ group: inCandidates, direction }) || focused;
      } else if (horizontal) {
        const group = inTabs || inSummary;

        if (group) {
          target = nextMenuButton({ group, direction });
        } else if (
          selection.tab === 'trade' &&
          focused.closest('[data-trade-items], [data-stock-items]')
        ) {
          const columns = ['[data-trade-items]', '[data-stock-items]'].map(
            (selector) =>
              [...query(root, selector).querySelectorAll('.dock-trade-table')]
                // Each heading and its preceding gap occupy two row positions.
                .flatMap((table) => [null, null, ...buttons(table)]),
          );
          const to = direction < 0 ? 0 : 1;
          const index = columns[1 - to].indexOf(focused as HTMLButtonElement);

          if (index >= 0) {
            const rows = columns[to];
            const at = Math.min(index, rows.length - 1);

            target = rows[at] || rows[at - 1] || rows[at + 1];
          }
        }
      } else if (inTabs) {
        if (direction > 0) {
          target = firstButton('.dock-summary') || firstContent();
        }
      } else if (inSummary) {
        target = direction > 0 ? firstContent() : activeTab();
      } else if (focused === footer) {
        if (direction < 0) {
          target =
            (footerOrigin?.isConnected &&
            buttons().includes(footerOrigin as HTMLButtonElement)
              ? footerOrigin
              : undefined) ||
            buttons(inspector).at(-1) ||
            buttons(query(root, '[data-trade-stock]')).at(-1) ||
            buttons(query(root, '[data-sidebar]')).at(-1) ||
            firstButton('.dock-summary') ||
            activeTab();
        }
      } else {
        const group =
          focused.closest('[data-hangar]') ||
          focused.closest('[data-trade-items], [data-stock-items], nav');
        const column = group ? buttons(group) : [];
        const index = column.indexOf(focused as HTMLButtonElement);

        target =
          column[index + direction] ||
          (direction > 0
            ? footer
            : firstButton('.dock-summary') || activeTab());
      }

      if (target === footer) footerOrigin = focused;
      focusMenuTarget(target, event.key);
    },
    { capture: true, signal: screen.signal },
  );

  ['focusin', 'pointermove', 'pointerdown'].forEach((type) => {
    root.addEventListener(
      type,
      (event) => {
        const target = event.composedPath()[0] as HTMLElement;
        const element = target.closest<HTMLElement>('[data-key]');

        if (type !== 'focusin') {
          setKeyboard(false);
        } else if (target.matches(':focus-visible')) {
          setKeyboard(true);
        }

        if (
          type === 'focusin' &&
          target.closest('.dock-inspector') &&
          currentKey
        ) {
          if (!detailOrigin) {
            const row = root.querySelector<HTMLElement>(
              `[data-key="${currentKey}"]`,
            );

            if (row) rememberOrigin(row);
          }

          inDetails = true;
          selection.inspected = currentKey;
        }

        if (element) {
          inspect(element);
        } else {
          if (type === 'focusin') inspectedCandidate = '';
          update();
        }
      },
      { signal: screen.signal },
    );
  });

  ['pointerout', 'focusout'].forEach((type) => {
    root.addEventListener(
      type,
      (event) => {
        const target = event.composedPath()[0] as HTMLElement;
        const related = (event as FocusEvent)
          .relatedTarget as HTMLElement | null;

        const candidateSelector = '[data-candidates] [data-key]';
        const fromCandidate = target.closest(candidateSelector);
        const toCandidate = related?.closest?.<HTMLElement>(candidateSelector);

        if (fromCandidate && type === 'focusout' && toCandidate) return;

        if (fromCandidate && fromCandidate !== toCandidate) {
          const active =
            (type === 'pointerout' &&
              candidateList.querySelector<HTMLElement>(
                '[data-key]:focus-visible',
              )) ||
            (ui.element.classList.contains('ui-arrow-navigation')
              ? null
              : candidateList.querySelector<HTMLElement>('[data-key]:hover'));
          const key = active?.getAttribute('data-key') || '';

          if (inspectedCandidate !== key) {
            inspectedCandidate = key;
            update();
          }
        }

        const rowSelector =
          '[data-loadout] [data-key], [data-trade-items] [data-key], [data-stock-items] [data-key]';
        const from = target.closest(rowSelector);
        const to = related?.closest?.(rowSelector);

        // The destination row's focusin will inspect and render it directly.
        if (!from || from === to || (type === 'focusout' && to)) return;

        if (selection.tab === 'trade' && related?.closest?.('.dock-detail')) {
          return;
        }

        const active = root.querySelector<HTMLElement>(
          `:is(${rowSelector}):hover, :is(${rowSelector}):focus`,
        );
        const key = active?.getAttribute('data-key') || selection.key;

        if (selection.inspected === key) return;
        selection.inspected = key;
        update();
      },
      { signal: screen.signal },
    );
  });

  root.addEventListener(
    'ui-press',
    (event) => {
      const target = event.composedPath()[0] as HTMLElement;
      const element = target.closest<HTMLButtonElement>('button');

      if (!element) {
        if (target.closest('.dock-detail')) return;
        root.querySelector<HTMLElement>(':focus')?.blur();
        return open(selection.tab);
      }

      if (
        element.disabled ||
        element.getAttribute('aria-disabled') === 'true'
      ) {
        return;
      }

      const ship = player.ship;

      if (element.hasAttribute('data-dialog-cancel')) {
        element.closest('dialog').close();
        return;
      }

      if (element.hasAttribute('data-visit-hangar')) {
        element.closest('dialog').close();
        open('hangar');
        activeTab().focus();
        return;
      }

      if (element.hasAttribute('data-confirm-ship-sale')) {
        applyHangarAction('SELL', dialogShipId);
        saleDialog.close();
        update();
        return;
      }

      if (element.hasAttribute('data-confirm-ship-name')) {
        query<HTMLFormElement>(root, '[data-ship-rename-form]').requestSubmit();
        return;
      }

      if (
        element.getAttribute('data-tab') ||
        element.hasAttribute('data-purchase-ship')
      ) {
        open(element.getAttribute('data-tab') || 'hangar');
        activeTab().focus();
        return;
      }

      if (element.hasAttribute('data-key') && selection.tab !== 'trade') {
        selectRow({ element, event: event.detail });
        return;
      }

      if (element.hasAttribute('data-refuel')) {
        refuelShip(ship);
        update();

        if (element.disabled) firstButton('[data-overview]')?.focus();
        return;
      }

      if (element.hasAttribute('data-launch')) return back();

      if (selection.tab === 'hangar') {
        const owned = selectedHangarShip();
        const command = element.getAttribute('data-hangar-command');

        if (element.hasAttribute('data-paint') && owned) {
          applyHangarAction(
            'PAINT',
            owned.id,
            element.getAttribute('data-paint'),
          );
        } else if (command === 'BUY' || command === 'SPECIAL') {
          purchaseShipIds = player.ships.map((ship) => ship.id);
          applyHangarAction(command, 0, selection.key.slice('offer:'.length));
        } else if (owned) {
          if (command === 'SELL') {
            dialogShipId = owned.id;
            text(
              '[data-ship-sale-description]',
              `Are you sure you want to sell ${owned.name}, including all cargo and fitted modules?`,
            );
            setHtml(
              query(root, '[data-ship-sale-values]'),
              saleValues(owned)
                .filter(
                  ([label, value]) =>
                    value || (label !== 'Repairs' && label !== 'Refueling'),
                )
                .map(
                  ([label, value]) =>
                    `<dt>${label}</dt><dd class="text-right">${money(value)}</dd>`,
                )
                .join('') +
                `<dt class="dock-sale-total">Total</dt><dd class="dock-sale-total text-right">${money(salePrice(owned))}</dd>`,
            );
            saleDialog.showModal();
          } else if (command === 'RENAME') {
            dialogShipId = owned.id;
            renameInput.value = owned.name;
            renameInput.setCustomValidity('');
            renameDialog.showModal();
            renameInput.select();
          } else if (command === 'PAINT') {
            hangarPaint = !hangarPaint;
          } else if (
            command === 'PILOT' ||
            command === 'REPAIR' ||
            command === 'REFUEL'
          ) {
            applyHangarAction(command, owned.id);
          }
        }

        update();

        if (command === 'PAINT' && hangarPaint) {
          firstButton('[data-paints]')?.focus();
        }

        return;
      }

      if (element.hasAttribute('data-hull-paint')) {
        rememberOrigin(element);
        inDetails = true;
        selection.key = selection.inspected = 'paint';
        selection.candidate = '';
        inspectedCandidate = '';
        update();
        firstButton('[data-paints]')?.focus();
        return;
      } else if (element.hasAttribute('data-repair-all')) {
        repairAll();
      } else {
        if (element.hasAttribute('data-key')) inspect(element);
        const [kind, value] = currentKey.split(':');
        const index = Number(value),
          mount = kind === 'mount' ? ship.mounts[index] : undefined;
        const item: any = currentItem;
        const command =
          element.getAttribute('data-command') ||
          (element.closest('[data-trade-items]')
            ? 'SELL'
            : element.closest('[data-stock-items]')
              ? 'BUY'
              : undefined);

        if (element.hasAttribute('data-paint')) {
          applyCraftAction(ship, {
            action: 'paint',
            paint: Number(element.getAttribute('data-paint')),
            ...(selection.key !== 'paint' && {
              moduleId: item.id,
              ...(mount?.module && { mount: index }),
            }),
          });
        }

        if (command === 'FIX') {
          if (kind === 'hull') {
            repairHullSegment({ ship, hullIndex: index });
          } else {
            applyCraftAction(ship, {
              action: 'repair',
              moduleId: item.id,
              mount: index,
            });
          }
        }

        if (command === 'BUY') {
          const stockObject =
            kind === 'shop' &&
            (
              ship.world?.entities.get(ship.dockedTo) as Craft | undefined
            )?.cargoContents.find((object) =>
              item instanceof Module
                ? object.id === item.id
                : object.item === item,
            );

          const applied = stockObject
            ? applyCraftAction(ship, {
                action: 'buyStock',
                objectIds: [stockObject.id],
              })
            : typeof item === 'function'
              ? applyCraftAction(ship, {
                  action: 'buy',
                  module: moduleTypes.indexOf(item),
                  ...(mount && { mount: index }),
                })
              : undefined;

          if (applied?.action === 'buyStock') {
            inDetails = false;
            selection.key = '';
          }

          if (applied?.action === 'buy') {
            selection.candidate = `owned-${applied.moduleId}`;
            inspectedCandidate = '';

            if (mount?.module) {
              selection.candidate = '';
              update();
              (buttons(detail)[0] || detail).focus();
              return;
            }
          }
        }

        if (command === 'BUY_AMMO') {
          buyAmmo(ship);
        }

        if (command === 'EQUIP') {
          const applied = applyCraftAction(ship, {
            action: 'equip',
            moduleId: item.id,
            mount: index,
          });

          if (applied) {
            selection.candidate = '';
            inspectedCandidate = '';
            update();
            (buttons(detail)[0] || detail).focus();
            return;
          }
        }

        if (command === 'REMOVE') {
          removeModule({ ship, mount: index });
          selection.candidate = '';
          inspectedCandidate = '';
        }

        if (command === 'SELL') {
          const object =
            item instanceof Module
              ? item
              : ship.cargoContents.find((object) => object.item === item);

          const sold = applyCraftAction(ship, {
            action: 'sell',
            objectIds: object ? [object.id] : [],
          });

          if (sold && item.resource === 0) unlockPaint('CYAN', 'DIAMOND SOLD');

          if (sold && selection.tab === 'outfitting') {
            selection.candidate = '';
            inspectedCandidate = '';
          }

          if (kind === 'cargo') {
            inDetails = false;
            selection.key = '';
          }
        }
      }

      update();

      if (!inDetails && !selection.key) detailOrigin = undefined;
    },
    { signal: screen.signal },
  );

  screen.signal.addEventListener('abort', preview.destroy);
  screen.signal.addEventListener('abort', () => thumbnailObserver.disconnect());
  screen.update = update;
  screen.escape = back;
  applyHangarAction('LIST');
  return screen;
};

export default { createDocked };
