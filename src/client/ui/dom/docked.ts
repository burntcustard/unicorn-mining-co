import html from './docked.html?raw';
import './docked.css';
import pentagon from '../icons/corral-5.svg?raw';
import hexagon from '../icons/corral-6.svg?raw';
import { createScreen, query, ui } from './ui';
import { player, paintUnlocked, unlockPaint } from '../../player';
import { paintColors } from '../../../specs/colors';
import { type Craft } from '../../objects/craft';
import { type ItemSpec } from '../../../specs/items/types';
import { autogunAmmo } from '../../../specs/items';
import { Module, moduleMaximumHealth } from '../../objects/modules/module';
import { moduleTypes } from '../../objects/modules';
import { fitsOf, cargoMenuEntriesOf } from '../docked-model';
import {
  sendAppliedAction,
  repairHullSegment,
  buyAmmo,
  refuelShip,
  removeModule,
} from '../docked-actions';
import shipPreview from './ship-preview';
import {
  moduleCategories,
  moduleCategoryIds,
} from '../../../specs/modules/categories';
import { icons } from '../icons';
import { shipIcon } from './ship-icon';
import { type Mount } from '../../types';
import { reconcileRows } from '../../utilities/reconcile-rows';

const tabContent = new Map([
  [
    'overview',
    {
      title: 'Ship overview',
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
    'services',
    {
      title: 'Services',
      description:
        'Repair your hull and fitted modules, or change your hull paint.',
    },
  ],
]);

const createDocked = () => {
  const screen = createScreen(html);
  const root = screen.element;
  const preview = shipPreview.createShipPreview(
    query<HTMLCanvasElement>(root, '.dock-preview'),
  );

  const selection = {
    tab: 'overview',
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

  const text = (selector: string, value: string) => {
    query(root, selector).textContent = value;
  };

  const money = (value: number) => `$${value.toLocaleString('en-US')}`;
  const health = (value: number, maximum: number) =>
    `${Math.floor(value)} / ${maximum}`;
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
  const buttons = (element: ParentNode = root) =>
    [
      ...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ].filter((button) => button.getClientRects().length);
  const firstButton = (selector: string) => buttons(query(root, selector))[0];
  const activeTab = () =>
    query<HTMLButtonElement>(root, '[data-tab][aria-current="page"]');
  let detailOrigin: (() => HTMLElement) | undefined;

  const rememberOrigin = (element: HTMLElement) => {
    const group =
      element.closest('[data-trade-items]') || element.closest('nav') || root;
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
    } else if (kind === 'hull') preview.thumbnail(detailPreview, Number(index));
  };

  const thumbnailObserver = new ResizeObserver(drawThumbnails);

  thumbnailObserver.observe(loadout);
  thumbnailObserver.observe(detailPreview);

  const moduleRow = ({ mount, index }: { mount: Mount; index: number }) => {
    const module = mount.module;
    const color = module ? moduleCategories.get(module.category).color : '#bbc';
    const icon = icons.get(module ? module.icon : './empty.svg');
    const condition = module
      ? `<small class="dock-row-text ml-auto">${health(mount.health, moduleMaximumHealth(module))}</small>`
      : '';

    return `<button class="button dock-row ui-hover-extend ui-inline gap-2${module ? '' : ' dock-empty'}" data-key="mount:${index}" style="--ui-color:${color}">
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
    <button class="button dock-row ui-hover-extend ui-inline gap-2" data-key="hull:${index}">
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

    element.style.setProperty('--paint', shades[2]);
    element.setAttribute(
      'aria-label',
      ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Violet', 'White'][index] +
        ' paint',
    );
    element.setAttribute('data-paint', String(index));
    query(root, '[data-paints]').append(element);
    return element;
  });

  const update = () => {
    const ship = player.ship;
    const mounts = ship.mounts;
    const hullHealth = ship.hullHealth;
    const station = ship.world?.entities.get(ship.dockedTo) as
      | Craft
      | undefined;
    const trading = selection.tab === 'trade';
    const cargo = cargoMenuEntriesOf(ship);
    const stock = cargoMenuEntriesOf(station || { cargoContents: [] });

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
      inspectedCandidate,
      inDetails,
      hullHealth,
      ship.fuel,
      ship.moduleStates,
      ship.cargoContents.map((object) => [object.id, object.health]),
      player.credits,
      player.unlockedPaints,
      ship.shades,
      station?.definitionId,
      station?.moduleStates,
      station?.cargoContents.map((object) => [object.id, object.health]),
    ]);

    if (previousView === view) return;
    const focused = root.querySelector<HTMLButtonElement>('button:focus');
    const focusGroup =
      focused?.closest('[data-trade-items]') ||
      focused?.closest('nav, .ui-actions') ||
      inspector;
    const focusIndex = focused ? buttons(focusGroup).indexOf(focused) : -1;
    const focusKey = focused?.getAttribute('data-key');

    previousView = view;
    text('[data-back-label]', inDetails || selection.key ? 'Back' : 'Launch');
    const launchIcon = query(root, '.dock-launch-icon');

    launchIcon.hidden = Boolean(inDetails || selection.key);
    setHtml(launchIcon, shipIcon(ship));

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

    const stationName = station?.definitionId || 'corral-5';

    text('[data-station]', stationName);
    setHtml(
      query(root, '.dock-station-icon'),
      stationName === 'corral-6' ? hexagon : pentagon,
    );
    text('[data-fuel]', `${ship.fuel.toFixed(1)} / ${ship.fuelCapacity} L`);
    text('[data-fuel-price]', money(ship.refuelCost));
    query<HTMLButtonElement>(root, '[data-refuel]').disabled =
      !ship.refuelCost || player.credits < ship.refuelCost;
    text('[data-balance]', money(player.credits));
    text('[data-ship-name]', ship.name);
    text(
      '[data-hull-condition]',
      `${Math.round((ship.hullHealthTotal / ship.hullMaxHealth) * 100)}%`,
    );
    const repairTotal =
      ship.repairCost() +
      mounts.reduce((sum, entry) => sum + ship.repairCost(entry), 0);

    text('[data-repair-total]', money(repairTotal));
    query<HTMLButtonElement>(root, '[data-repair-all]').disabled =
      !repairTotal || player.credits < repairTotal;
    query<HTMLButtonElement>(root, '[data-service="repair"]').disabled =
      !repairTotal || player.credits < repairTotal;
    text(
      '[data-cargo-total]',
      `${ship.cargoContents.length} / ${ship.cargoSpace}`,
    );
    text('[data-hull-total]', health(ship.hullHealthTotal, ship.hullMaxHealth));
    text(
      '[data-module-count]',
      `${mounts.filter((entry) => entry.module).length} / ${mounts.length}`,
    );

    root
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((element) => {
        if (element.getAttribute('data-tab') === selection.tab) {
          element.setAttribute('aria-current', 'page');
        } else element.removeAttribute('aria-current');
      });

    query(root, '.dock-summary').hidden = trading;
    query(root, '.dock-center').hidden = trading;
    query(root, '[data-trade-stock]').hidden = !trading;

    ['overview', 'outfitting', 'trade', 'services'].forEach((tab) => {
      query(root, `[data-${tab}]`).hidden = tab !== selection.tab;
    });

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
            `<button class="button dock-row ui-hover-extend ui-inline gap-2" data-key="${itemKey(entry)}"
            style="--ui-color:${moduleCategories.get(entry.category).color}">
            <span>${icons.get(entry.icon)}</span><span class="dock-row-text">${entry.name}</span>
            <small class="dock-row-text ml-auto">${money(entry.price)}</small>
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
            `<button class="button dock-row dock-trade-row ui-hover-extend" data-key="${kind}:${tradeKey(entry)}"
              style="--ui-color:${entry instanceof Module ? moduleCategories.get(entry.category).color : '#eef'}"
              aria-disabled="${kind === 'shop' && (ship.cargoContents.length >= ship.cargoSpace || player.credits < entry.price)}"
              aria-label="${kind === 'cargo' ? 'Sell' : 'Buy'} one ${entry.name || entry.label} for ${money(entry.price || 0)}, supply ${count}">
              <span class="px-3 dock-trade-name" data-trade-action="${kind === 'cargo' ? 'SELL' : 'BUY'}"><span class="dock-row-text">${entry.name || entry.label}</span></span>
              <small class="px-3 text-right dock-trade-supply" aria-hidden="true"><span class="dock-row-text">${count.toLocaleString('en-US')}</span></small>
              <small class="px-3 text-right dock-trade-price" aria-hidden="true"><span class="dock-row-text">${money(entry.price || 0)}</span></small>
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
            `<section class="dock-trade-table" data-trade-group="${name.toLowerCase()}">
              <div class="dock-trade-heading uppercase text-muted text-sm">
                <h3 class="px-3">${name}</h3><span class="px-3 text-right">Supply</span><span class="px-3 text-right">${kind === 'cargo' ? 'Sell' : 'Buy'}</span>
              </div>
              <nav class="dock-group uppercase text-sm" aria-label="${name} ${kind === 'cargo' ? 'in cargo' : 'in station stock'}">${tradeRows(entries, kind)}</nav>
            </section>`,
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
          ? module.name
          : item
            ? item.name || item.label
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
      paintHull
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
            ? item.health
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
          ? `<h3 class="text-sm uppercase">Output</h3><div class="text-color text-lg mt-4">${module.powerGenerated.toFixed(1)} MW</div>`
          : `<h3 class="text-sm uppercase">Power consumption</h3><div class="ui-inline gap-12 mt-4"><div><span class="block text-muted text-sm uppercase">Idle</span><span class="text-color text-lg">${module.power.toFixed(1)} MW</span></div><div><span class="block text-muted text-sm uppercase">Active</span><span class="text-color text-lg">${module.powerActivated.toFixed(1)} MW</span></div></div>`
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
    const ammo =
      module?.ammo === autogunAmmo.resource ? autogunAmmo : undefined;
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
            ? !hasSpace ||
              (action === 'BUY_AMMO' &&
                !stock.some(([entry]) => entry === ammo)) ||
              player.credits <
                (action === 'BUY_AMMO' ? ammo?.price : item?.price)
            : action === 'REMOVE' || (action === 'SELL' && equipped)
              ? !hasSpace
              : false;
    });

    text('[data-repair]', money(repairCost));
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
    query(root, '[data-paints]').className =
      `ui-actions gap-4 dock-paints${paintHull ? '' : ' mt-4'}`;

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
      (sum, entry) => sum + entry.module.powerActivated,
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
      const parts = consumers
        .map(({ module, at }) => {
          const value = active ? module.powerActivated : module.power;
          const highlighted =
            previewHull < 0 ||
            (previewMount
              ? at === previewIndex
              : hullIndexOf(at) === previewHull);

          return `<span class="dock-power-part" title="${module.name}: ${value.toFixed(1)} MW"
          style="--ui-color:${moduleCategories.get(module.category).color};
          width:${(value / scale) * 100}%;opacity:${highlighted ? 1 : 0.25}"></span>`;
        })
        .join('');

      const generation = output
        ? `<span class="dock-generation" title="Output: ${output.toFixed(1)} MW"
            style="left:${(output / scale) * 100}%"></span>`
        : '';

      return `<div class="dock-power-label ui-row gap-3 mt-4 mb-2">
        <span class="uppercase">${label}</span><span>${total.toFixed(1)} MW</span>
      </div><div class="dock-power-track">${parts}${generation}</div>`;
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

    setHtml(
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
      active: !previewCandidate || !!inspectedCandidate,
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
            ? candidateList
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

    if (element.closest('[data-candidates]')) {
      inspectedCandidate = key;
    } else {
      inDetails = false;
      selection.inspected = key;
      inspectedCandidate = '';
    }

    update();
  };

  const selectRow = (element: HTMLElement) => {
    const key = element.getAttribute('data-key');
    const candidate = element.closest('[data-candidates]');

    if (candidate) selection.candidate = key;
    else {
      rememberOrigin(element);
      selection.key = key;
      selection.candidate = '';
    }

    inspect(element);
    inDetails = true;

    if (!candidate) {
      (key.startsWith('mount:') && !currentItem
        ? candidateList.getClientRects().length
          ? candidateList
          : element
        : buttons(detail)[0] || detail
      ).focus();
    }

    update();

    if (candidate) detail.scrollTop = 0;
  };

  const launch = () => {
    player.ship.launchRequested = 1;
    ui.clear();
  };

  const back = () => {
    if (!inDetails && !selection.key) return launch();
    inDetails = false;
    const row =
      detailOrigin?.() ||
      root.querySelector<HTMLElement>(
        `[data-key="${selection.key || selection.inspected}"]`,
      );

    selection.key = selection.candidate = '';
    inspectedCandidate = '';
    detailOrigin = undefined;
    selection.inspected = row?.getAttribute('data-key') || '';
    (row || query<HTMLElement>(root, '[data-hull-paint]')).focus();
    update();
  };

  const repairAll = () => {
    const ship = player.ship;
    const total =
      ship.repairCost() +
      ship.mounts.reduce((sum, mount) => sum + ship.repairCost(mount), 0);

    if (player.credits < total) return;
    sendAppliedAction(ship, { action: 'repair' });

    ship.mounts.forEach((mount, index) => {
      if (mount.module) {
        sendAppliedAction(ship, {
          action: 'repair',
          mount: index,
          moduleId: mount.module.id,
        });
      }
    });
  };

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

      if (event.key === 'Escape') {
        event.preventDefault();

        if (!event.repeat) back();
        return;
      }

      const focused = root.querySelector<HTMLElement>(':focus');
      const available = buttons();
      const horizontal =
        event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';

      if (event.key === 'Tab') {
        ui.element.classList.remove('ui-arrow-navigation');
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
        activeTab().focus();
        return;
      }

      const direction =
        event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const inTabs = focused.closest('.ui-tabs');
      const inSummary = focused.closest('.dock-summary');
      const inPaints = focused.closest('[data-paints]');
      const inInspector = focused.closest('.dock-inspector');
      const footer = firstButton('.dock-footer');
      const firstContent =
        firstButton('[data-sidebar]') ||
        firstButton('[data-trade-stock]') ||
        footer;
      let target: HTMLElement;

      if (horizontal) {
        const group = inTabs || inSummary || inPaints;

        if (group) {
          const row = buttons(group);

          target = row.at(
            (row.indexOf(focused as HTMLButtonElement) + direction) %
              row.length,
          );
        } else if (
          selection.tab === 'trade' &&
          focused.closest(
            '[data-trade-items], [data-stock-items], .dock-detail',
          )
        ) {
          const columns = ['[data-trade-items]', '[data-stock-items]'].map(
            (selector) => buttons(query(root, selector)),
          );
          const key = focused.getAttribute('data-key') || currentKey;
          const from = key.startsWith('cargo:') ? 0 : 1;
          const to = direction < 0 ? 0 : 1;

          if (from === to || !columns[to].length) return;
          const index = columns[from].findIndex(
            (button) => button.getAttribute('data-key') === key,
          );

          target =
            columns[to][Math.min(Math.max(index, 0), columns[to].length - 1)];
        }
      } else if (inTabs) {
        if (direction > 0) {
          target = firstButton('.dock-summary') || firstContent;
        }
      } else if (inSummary) {
        target = direction > 0 ? firstContent : activeTab();
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
      } else if (inPaints) {
        target =
          direction > 0
            ? footer
            : buttons(inspector)
                .filter((button) => !button.closest('[data-paints]'))
                .at(-1) ||
              firstButton('.dock-summary') ||
              activeTab();
      } else {
        const group =
          inInspector ||
          focused.closest('[data-trade-items]') ||
          focused.closest('nav');
        const column = group
          ? buttons(group).filter((button) => !button.closest('[data-paints]'))
          : [];
        const index = column.indexOf(focused as HTMLButtonElement);

        target =
          column[index + direction] ||
          (direction > 0
            ? (inInspector && firstButton('[data-paints]')) || footer
            : firstButton('.dock-summary') || activeTab());
      }

      if (target === footer) footerOrigin = focused;
      target?.focus();
      update();
    },
    { capture: true, signal: screen.signal },
  );

  ['focusin', 'pointermove'].forEach((type) => {
    root.addEventListener(
      type,
      (event) => {
        const target = event.composedPath()[0] as HTMLElement;
        const element = target.closest<HTMLElement>('[data-key]');

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

        if (element) inspect(element);
        else {
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

        if (
          fromCandidate &&
          fromCandidate !== related?.closest?.(candidateSelector)
        ) {
          const active =
            (type === 'focusout'
              ? related?.closest?.<HTMLElement>(candidateSelector)
              : candidateList.querySelector<HTMLElement>(
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

        if (!from || from === to) return;

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
    'click',
    (event) => {
      const element = (
        event.composedPath()[0] as HTMLElement
      ).closest<HTMLButtonElement>('button');

      if (!element) {
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

      if (
        element.getAttribute('data-tab') ||
        element.getAttribute('data-open')
      ) {
        open(
          element.getAttribute('data-tab') || element.getAttribute('data-open'),
        );
        activeTab().focus();
        return;
      }

      if (element.hasAttribute('data-key') && selection.tab !== 'trade') {
        selectRow(element);
        return;
      }

      if (element.hasAttribute('data-refuel')) {
        refuelShip(ship);
        update();

        if (element.disabled) firstButton('[data-overview]')?.focus();
        return;
      }

      if (element.hasAttribute('data-launch')) return back();

      if (
        element.hasAttribute('data-hull-paint') ||
        element.getAttribute('data-service') === 'paint'
      ) {
        rememberOrigin(element);
        inDetails = true;
        selection.key = selection.inspected = 'paint';
        selection.candidate = '';
        inspectedCandidate = '';
        update();
        firstButton('[data-paints]')?.focus();
        return;
      } else if (
        element.hasAttribute('data-repair-all') ||
        element.getAttribute('data-service') === 'repair'
      ) {
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
          sendAppliedAction(ship, {
            action: 'paint',
            paint: Number(element.getAttribute('data-paint')),
            ...(selection.key !== 'paint' && {
              moduleId: item.id,
              ...(mount?.module && { mount: index }),
            }),
          });
        }

        if (command === 'FIX') {
          if (kind === 'hull') repairHullSegment(ship, index);
          else {
            sendAppliedAction(ship, {
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
            ? sendAppliedAction(ship, {
                action: 'buyStock',
                objectIds: [stockObject.id],
              })
            : typeof item === 'function'
              ? sendAppliedAction(ship, {
                  action: 'buy',
                  module: moduleTypes.indexOf(item),
                })
              : undefined;

          if (applied?.action === 'buyStock') {
            inDetails = false;
            selection.key = '';
          }

          if (applied?.action === 'buy') {
            selection.candidate = `owned-${applied.moduleId}`;
            inspectedCandidate = '';
          }
        }

        if (command === 'BUY_AMMO') buyAmmo(ship);

        if (command === 'EQUIP') {
          const applied = sendAppliedAction(ship, {
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
          removeModule(ship, index);
          selection.candidate = '';
          inspectedCandidate = '';
        }

        if (command === 'SELL') {
          if (mount?.module) {
            removeModule(ship, index);
          }

          const object = ship.cargoContents.find((object) =>
            item instanceof Module
              ? object.id === item.id
              : object.item === item,
          );

          const sold = sendAppliedAction(ship, {
            action: 'sell',
            objectIds: object ? [object.id] : [],
          });

          if (sold && item.resource === 0) unlockPaint('CYAN', 'DIAMOND SOLD');

          if (sold && selection.tab === 'outfitting') {
            back();
            return;
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
  return screen;
};

export default { createDocked };
