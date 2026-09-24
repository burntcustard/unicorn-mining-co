import { Module } from '../../shared/modules/module';
import { type Ship } from '../../shared/craft/ship';
import { type GameState } from '../game';
import { paintUnlocked, say, unlockPaint } from '../player';
import { colors, paintColors } from '../../shared/colors';
import { launch } from '../../shared/simulation/docking';
import { outline } from '../outline';
import { playSound } from '../sound-loader';
import { renderText } from '../text';
import { moduleTypes } from '../../shared/modules';
import { sendCraftAction } from '../craft-actions';

/**
 * The panel shown over everything while a ship sits in a bay: a plain
 * rectangle split into three columns, dimmed out behind it so the panel reads
 * as the only thing worth looking at.
 *
 * The left column is the current menu. Picking an item replaces that menu with
 * the next one, while the middle column describes the picked-out module.
 */
// How far the list of mounts sits in from the panel's own edges, how far
// each row drops below the last, how big its text is, and how far a column
// sits in from its neighbour
const listInset = 24;
const rowGap = 24;
const textSize = 0.6;
const colGap = 10;

// How much a row's own background is padded above and below its text, and
// how far its text sits in from its own left edge
const rowPad = 4;
const textPad = 8;

const paints = [...paintColors];

// How far a paint square sits in from its square button's edge, and the size
// that leaves it
const swatchInset = 5;
const swatchSize = rowGap - rowPad - swatchInset * 2;

// Which mount is picked out, which of its fitting modules, and how far into
// picking one out the pilot has got: 0 browsing mounts, 1 browsing modules
// that fit the one picked out, 2 choosing an action for that module.
// Kept here rather than on the ship, since all of this is
// purely a UI focus over its mounts and not part of the ship itself
let mountOption = 0;
let moduleOption = 0;
let focused = 0;
let stage = 0;

// Cargo instances carry their item data directly, and a stowed module is its
// own data, so collect like things into one menu entry with how many are aboard.
const cargoMenuEntriesOf = (ship: any) => [
  ...ship.cargoContents
    .map((object: any) => object.item || object)
    .reduce(
      (types: Map<any, number>, item: any) =>
        types.set(item, (types.get(item) || 0) + 1),
      new Map(),
    ),
];

// Ore of a kind stacks into one row, but two module instances never do, so a
// count is only worth showing when there is more than one
const cargoMenuEntryName = ([item, count]: any[]) =>
  count > 1 ? `${item.label} *${count}` : item.label;

const hullHealthOf = (ship: any) =>
  ship.segments
    .filter(({ hull }: any) => hull)
    .reduce((total: number, { health }: any) => total + health, 0);
const hullMaxHealthOf = (ship: any) =>
  ship.hullSegments.reduce(
    (total: number, { health }: any) => total + health,
    0,
  );

// Health is displayed as a whole number, so repairing replaces every missing
// displayed HP, including the fractional remainder hidden by the UI.
const repairCostOf = (health: number, maxHealth: number) =>
  maxHealth - (health | 0);

// What a mount can be given, in the order its `fits` lists them: each module
// type stands in for itself while the pilot owns none of it, and is replaced in
// place by the ones they do own once they do. A Module instance can be equipped,
// sold and painted; its constructor in the catalogue can only be bought.
// Filtering the owned modules preserves acquisition order across fitting changes.
const moduleRows = new WeakMap<object, Module[]>();
const fitsOf = (ship: any, mount: any) => {
  const modules = ship.modules;
  const rows = (moduleRows.get(ship) || []).filter((module) =>
    modules.includes(module),
  );

  modules.forEach((module: Module) => {
    if (!rows.includes(module)) rows.push(module);
  });
  moduleRows.set(ship, rows);
  return mount.fits.flatMap((type: any) => {
    const owned = rows.filter(
      (module: any) =>
        module.constructor === type &&
        (!module.mount || module.mount === mount),
    );

    return owned.length ? owned : [type];
  });
};

// Fitting changes a mount link, while buying and selling change ownership.
const actionsOf = (ship: any, mount: any, module: any) => {
  const fitted = mount.module === module;
  const owned = module instanceof Module;

  return fitted
    ? mount.health < module.health
      ? ['FIX', 'REMOVE']
      : ['REMOVE']
    : owned
      ? ['EQUIP', 'SELL']
      : ['BUY'];
};

// One snapshot supplies navigation, actions and drawing with the same rows.
const selectionOf = (ship: any) => {
  const hullMenu = stage > 0 && mountOption === 1;
  const cargoMenu = stage > 0 && mountOption === 0;
  const mount = ship.mounts[mountOption - 2];
  const menu =
    stage && !hullMenu
      ? cargoMenu
        ? cargoMenuEntriesOf(ship)
        : fitsOf(ship, mount)
      : ['CARGO', 'HULL', ...ship.mounts];
  const currentItem = stage && !hullMenu ? moduleOption : mountOption;
  const item = menu[currentItem];
  const currentModule = hullMenu
    ? ship
    : stage && (cargoMenu ? item?.[0] : item);
  const repairCost = hullMenu
    ? repairCostOf(hullHealthOf(ship), hullMaxHealthOf(ship))
    : mount?.module && mount.module === currentModule
      ? repairCostOf(mount.health, currentModule.health)
      : 0;
  const actions =
    stage > 1
      ? hullMenu
        ? repairCost
          ? ['FIX']
          : []
        : cargoMenu
          ? ['SELL']
          : actionsOf(ship, mount, currentModule)
      : [];
  const swatches =
    stage > 1 && (hullMenu || currentModule instanceof Module) ? paints : [];
  const disabledAction = Number(
    !!actions[0] &&
      ship.credits < (actions[0] === 'BUY' ? currentModule.price : repairCost),
  );

  return {
    mount,
    menu,
    currentItem,
    item,
    currentModule,
    actions,
    swatches,
    hullMenu,
    cargoMenu,
    repairCost,
    disabledAction,
  };
};

/**
 * Move focus in the current menu.
 *
 * delta: -1 or 1.
 * sub: Set by the alternate controls, which stay on one row.
 */
export const moveSelection = (delta: number, ship: Ship, sub: number) => {
  playSound(8);
  const { menu, currentModule, actions, swatches, disabledAction } =
    selectionOf(ship);

  if (!stage) {
    mountOption = Math.max(0, Math.min(menu.length, mountOption + delta));
  } else if (stage === 1) {
    moduleOption = Math.max(0, Math.min(menu.length, moduleOption + delta));
  } else {
    const first = actions.length + 1;
    const onPaints = focused >= first;
    const availablePaints = swatches.filter(paintUnlocked);

    // Down drops from the action row onto the paint row, landing on the colour
    // already worn, and up comes back off it. Any other move runs along the
    // row focus is already on
    if (!sub && onPaints && delta < 0) {
      focused = disabledAction ? actions.length : 0;
    } else if (!sub && !onPaints && delta > 0 && swatches.length) {
      focused =
        first +
        swatches.indexOf(
          availablePaints[
            Math.max(
              0,
              availablePaints.indexOf(currentModule?.shades || ship.shades),
            )
          ],
        );
    } else if (onPaints) {
      const paint = availablePaints.indexOf(swatches[focused - first]);

      focused =
        first +
        swatches.indexOf(
          availablePaints[
            Math.max(0, Math.min(availablePaints.length - 1, paint + delta))
          ],
        );
    } else {
      focused = Math.max(
        +disabledAction,
        Math.min(actions.length, focused + delta),
      );
    }
  }
};

/**
 * Move focus with the alternate directional controls, which run along the row
 * focus is on rather than between rows.
 *
 * delta: -1 or 1.
 */
export const moveSubSelection = (delta: number, ship: Ship) =>
  moveSelection(delta, ship, 1);

/**
 * Step back out of the current docked menu.
 *
 * If there is no submenu to leave, launch the ship.
 */
export const back = (ship: Ship): void => {
  playSound(8);

  if (stage) {
    // The hull has nothing to pick out, so its actions are the whole submenu
    stage = mountOption === 1 ? 0 : stage - 1;
  } else {
    launch(ship);
    ship.launchRequested = 1;
    ship.started = 1;
  }
};

/**
 * Drill into the mount picked out, then the module picked out of its list,
 * then carry out the action picked from those possible for that module.
 */
export const confirmSelection = (ship: Ship) => {
  playSound(8);
  const {
    mount,
    menu,
    currentModule,
    actions,
    swatches,
    hullMenu,
    cargoMenu,
    repairCost,
  } = selectionOf(ship);

  if (stage < 2) {
    if ((stage ? moduleOption : mountOption) === menu.length) return back(ship);

    if (!stage) moduleOption = 0;
    focused = 0;
    stage = stage || mountOption === 1 ? 2 : 1;

    if (stage > 1) {
      const { disabledAction, actions } = selectionOf(ship);

      focused = +(disabledAction && actions.length);
    }

    return;
  }

  const picked = actions[focused];
  // The swatch row sits after the actions and their BACK button
  const shades = swatches[focused - actions.length - 1];

  if (shades) {
    if (!paintUnlocked(shades)) return;
    currentModule.shades = shades;
    ship.segments
      .filter((segment: any) =>
        hullMenu ? segment.hull : segment.module === currentModule,
      )
      .forEach((segment: any) => (segment.shades = shades));
    sendCraftAction({
      action: 'paint',
      ...(hullMenu
        ? {}
        : {
            moduleId: currentModule.id,
            ...(mount?.module === currentModule && {
              mount: ship.mounts.indexOf(mount),
            }),
          }),
      paint: paints.indexOf(shades),
    });

    return;
  }

  if (!picked) return back(ship);

  if (picked === 'FIX') {
    ship.credits -= repairCost;
    hullMenu ? ship.fixHull() : (mount.health = currentModule.health);
    return;
  }

  if (picked === 'SELL') {
    const [item, count] = cargoMenu ? menu[moduleOption] : [currentModule, 1];

    ship.cargoContents = ship.cargoContents.filter(
      (object: any) => object !== item && object.item !== item,
    );
    ship.credits += item.price * count;

    if (item.label === 'DIAMOND') unlockPaint('CYAN', 'DIAMOND SOLD');
    moduleOption = Math.min(
      moduleOption,
      (cargoMenu ? cargoMenuEntriesOf(ship) : fitsOf(ship, mount)).length - 1,
    );

    // A sale returns to the list, leaving its replacement row focused rather
    // than treating it as though the pilot had picked it.
    stage = 1;

    if (moduleOption < 0) moduleOption = 0;

    return;
  }

  if (picked === 'BUY') {
    if (ship.cargoContents.length >= ship.cargoSpace) {
      say('CARGO FULL');
    } else {
      ship.credits -= currentModule.price;
      const module = new currentModule();

      ship.cargoContents.push(module);
      sendCraftAction({
        action: 'buy',
        module: moduleTypes.indexOf(currentModule),
        moduleId: module.id,
      });
    }
  } else {
    ship.fit(picked === 'EQUIP' && currentModule, mount);
    sendCraftAction(
      picked === 'EQUIP'
        ? {
            action: 'equip',
            moduleId: currentModule.id,
            mount: ship.mounts.indexOf(mount),
          }
        : { action: 'remove', mount: ship.mounts.indexOf(mount) },
    );
  }
};

// A row's own background, and its highlight when it's the one picked out in
// its column. Appended digit is the fill's opacity
const renderButton = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  focused: boolean,
  disabled: boolean,
) => {
  ctx.globalAlpha = disabled ? 0.3 : 1;

  ctx.fillStyle = `${colors.purple[2]}${focused ? '' : '9'}`;
  ctx.strokeStyle = `${colors.violet[2]}${focused ? '' : '0'}`;
  ctx.fillRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  ctx.strokeRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  ctx.globalAlpha = 1;
};

/**
 * Render the docked ship's mounts and cargo contents.
 */
export const renderDocked = (game: GameState, ship: Ship) => {
  const { ctx, uiScale, uiWidth, uiHeight } = game;
  const padding = listInset - rowPad;
  const outerPadding = padding * 4;
  const height = Math.max(
    uiHeight - outerPadding * 2,
    listInset + rowGap * 11 + padding - rowPad * 2,
  );
  const colWidth = (uiWidth - outerPadding * 2 - padding * 2 - colGap * 2) / 3;
  const top = (uiHeight - height) / 2 + listInset;

  // Left and right edges of the menu and information columns; the last third
  // is intentionally left empty for the next docked-menu feature.
  const col0: [number, number] = [
    outerPadding + padding,
    outerPadding + padding + colWidth,
  ];
  const col1: [number, number] = [
    col0[1] + colGap,
    col0[1] + colGap + colWidth,
  ];

  const {
    mount,
    menu,
    currentItem,
    item,
    currentModule,
    actions,
    swatches,
    hullMenu,
    cargoMenu,
    disabledAction,
  } = selectionOf(ship);
  const actionMenu = Number(stage > 1);
  const currentHull = item === 'HULL';
  const cargoMenuEntries =
    item === 'CARGO' ? cargoMenuEntriesOf(ship) : cargoMenu && item && [item];
  const selected = currentModule?.shades || ship.shades;
  const info =
    currentHull || cargoMenuEntries || currentModule || mount?.module;
  const health = currentHull
    ? hullHealthOf(ship)
    : mount?.module === info
      ? mount?.health
      : info?.health;
  const maxHealth = currentHull ? hullMaxHealthOf(ship) : info?.health;
  let actionX = 0;
  const actionButtons: any[] = [];
  // The action row, and the swatch row under it when there is paint to pick
  const extraRows = actionMenu + Number(Boolean(swatches.length));
  const menuY = (i: number) =>
    top + (i + (i > currentItem ? extraRows : 0)) * rowGap;
  const actionY = menuY(currentItem) + rowGap;
  const swatchX = col0[1] - swatchInset - swatchSize;

  // A square of paint with the same small outline as the text, filled solid
  // unless told it's only on offer rather than worn
  const renderSwatch = (x: number, y: number, shades: any, worn = 1) => {
    const path = new Path2D();

    path.rect(x, y - rowPad + swatchInset, swatchSize, swatchSize);
    ctx.fillStyle = `${shades[2]}${worn ? '' : '3'}`;
    ctx.strokeStyle = shades[2];
    ctx.fill(path);
    outline({ ctx, path, radius: textSize });
    ctx.stroke(path);
  };

  [...actions, 'BACK'].forEach((item) => {
    const width = item.length * 13 * textSize + textPad * 2;

    actionButtons.push({ item, width, x: col0[0] + actionX, y: actionY });
    actionX += width + rowPad;
  });
  // Square buttons of their own on the row below, carrying on the same focus
  swatches.forEach((shades, i) =>
    actionButtons.push({
      shades,
      width: rowGap - rowPad,
      x: col0[0] + i * rowGap,
      y: actionY + rowGap,
    }),
  );

  ctx.save();
  ctx.scale(uiScale, uiScale);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(
    outerPadding,
    top - listInset,
    uiWidth - outerPadding * 2,
    height,
  );

  menu.forEach((item: any, i: number) => {
    const y = menuY(i);

    renderButton(
      ctx,
      ...col0,
      y,
      !actionMenu && i === currentItem,
      actionMenu && i !== currentItem,
    );

    // One the pilot owns wears its paint on the right of its row — the hull
    // and a fitted mount included — which tells two cargo hatches apart from each
    // other and from the one on offer to buy
    const shades = (
      item === 'HULL' ? ship : item instanceof Module ? item : item.module
    )?.shades;

    if (shades) {
      renderSwatch(swatchX, y, shades);
    }
  });

  if (!actionMenu || hullMenu) {
    renderButton(
      ctx,
      ...col0,
      top + rowGap * 10,
      !hullMenu && currentItem === menu.length,
      hullMenu,
    );
  }

  if (actionMenu) {
    actionButtons.forEach(({ shades, width, x, y }: any, i: number) => {
      const locked = i < disabledAction || (shades && !paintUnlocked(shades));

      renderButton(ctx, x, x + width, y, focused === i, locked);

      // Appended digit is the fill's opacity, so a paint only on offer is a
      // wash inside its outline while the one worn is solid
      if (shades) {
        ctx.globalAlpha = locked ? 0.3 : 1;
        renderSwatch(x + swatchInset, y, shades, Number(shades === selected));

        if (locked) {
          ctx.beginPath();
          ctx.moveTo(x + swatchInset, y - rowPad + swatchInset);
          ctx.lineTo(
            x + swatchInset + swatchSize,
            y - rowPad + swatchInset + swatchSize,
          );
          ctx.stroke();
        }
      }
    });
  }

  if (info) {
    ctx.fillStyle = `${colors.purple[2]}8`;
    ctx.fillRect(col1[0], top - rowPad, colWidth, rowGap * 8 - rowPad);
    ctx.strokeStyle = `${colors.violet[2]}c`;
    ctx.beginPath();
    ctx.moveTo(col1[0], top + (rowGap - rowPad) * 1.5);
    ctx.lineTo(col1[1], top + (rowGap - rowPad) * 1.5);
    ctx.stroke();
  }

  ctx.restore();

  menu.forEach((item: any, i: number) => {
    let text = item.label;

    if (!stage || hullMenu) {
      if (i < 2) {
        text = item;
      } else {
        text = item.module?.label || '-EMPTY-';
      }
    } else if (cargoMenu) {
      text = cargoMenuEntryName(item);
    }

    renderText({
      game,
      text,
      x: col0[0] + textPad,
      y: menuY(i) + 2,
      size: textSize,
      align: -1,
      color:
        actionMenu && i !== currentItem
          ? `${colors.violet[2]}6`
          : colors.violet[2],
    });
  });

  if (actionMenu) {
    actionButtons.forEach(
      ({ item, x, y }, i) =>
        item &&
        renderText({
          game,
          text: item,
          x: x + textPad,
          y: y + 2,
          size: textSize,
          align: -1,
          color: i < disabledAction ? `${colors.violet[2]}6` : colors.violet[2],
        }),
    );
  }

  if (!actionMenu || hullMenu) {
    renderText({
      game,
      text: stage && !hullMenu ? 'BACK' : 'EXIT',
      x: col0[0] + textPad,
      y: top + rowGap * 10 + 2,
      size: textSize,
      align: -1,
      color: hullMenu ? `${colors.violet[2]}6` : colors.violet[2],
    });
  }

  if (info) {
    const labels = currentHull
      ? ['HULL', 'HP']
      : cargoMenuEntries
        ? ['CARGO', ...cargoMenuEntries.map(cargoMenuEntryName)]
        : [info.label, 'HP', 'VALUE'];
    const values = currentHull
      ? [`${health | 0}/${maxHealth}`]
      : cargoMenuEntries
        ? []
        : [`${health | 0}/${maxHealth}`, `$${info.price}`];

    labels.forEach((text, i) =>
      renderText({
        game,
        text,
        x: col1[0] + textPad,
        y: top + (i ? (i + 1) * rowGap + 2 : (rowGap - 4) / 2),
        size: textSize,
        align: -1,
        color: colors.violet[2],
      }),
    );

    values.forEach((text, i) =>
      renderText({
        game,
        text,
        x: col1[1] - textPad,
        y: top + (i + 2) * rowGap + 2,
        size: textSize,
        align: 1,
        color: colors.violet[2],
      }),
    );
  }
};

export default {
  renderDocked,
  moveSelection,
  moveSubSelection,
  back,
  confirmSelection,
};
