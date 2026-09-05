import { roomFor, say } from '../player';
import { colors } from '../colors';
import { instanceOf } from '../modules';
import { launch } from '../docking';
import { renderText } from '../text';

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

// The paints on offer, which is every colour but the two the panel itself is
// drawn in
const paints = Object.values(colors).filter((_, i) => i - 5 && i - 7);

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
const cargoOf = (ship) => Array.from([...ship.cargoBay, ...ship.cargo.map(({ item }) => item)]
  .reduce((types, item) => types.set(item, (types.get(item) || 0) + 1), new Map()));

// Ore of a kind stacks into one row, but two module instances never do, so a
// count is only worth showing when there is more than one
const cargoName = ([item, count]) => count > 1 ? `${item.name} *${count}` : item.name;

const hullActionsOf = (ship) => (ship.hullSegments.some((part) =>
  ship.segments.find(({ module }) => module === part)?.health !== part.health) ?
    ['FIX'] :
    []);

// What a mount can be given, in the order its `fits` lists them: each module
// type stands in for itself while the pilot owns none of it, and is replaced in
// place by the ones they do own once they do. An entry with a `oneOf` is an
// instance and can be equipped, sold and painted; one without can only be bought.
// Filtering the inventory preserves acquisition order across fitting changes.
const fitsOf = (ship, mount) => mount.fits.flatMap((type) => {
  const owned = ship.modules.filter((module) => module.oneOf === type &&
    (!module.mount || module.mount === mount));

  return owned.length ? owned : [type];
});

// Fitting changes a mount link, while buying and selling change ownership.
const actionsOf = (ship, mount, module) => {
  const fitted = mount.module === module;
  const owned = module.oneOf;

  return fitted ?
      [mount.health < module.health && 'FIX', 'REMOVE'].filter(Boolean) :
    owned ? ['EQUIP', 'SELL'] : ship.credits >= module.price ? ['BUY'] : [];
};

// One snapshot supplies navigation, actions and drawing with the same rows.
const selectionOf = (ship) => {
  const hullMenu = stage > 0 && mountOption === 1;
  const cargoMenu = stage > 0 && mountOption === 0;
  const mount = ship.mounts[mountOption - 2];
  const menu = stage && !hullMenu ? cargoMenu ? cargoOf(ship) : fitsOf(ship, mount) : ['CARGO', 'HULL', ...ship.mounts];
  const currentItem = stage && !hullMenu ? moduleOption : mountOption;
  const item = menu[currentItem];
  const currentModule = hullMenu ? ship : stage && (cargoMenu ? item?.[0] : item);
  const actions = stage > 1 ? hullMenu ? hullActionsOf(ship) : cargoMenu ? ['SELL'] : actionsOf(ship, mount, currentModule) : [];
  const swatches = stage > 1 && (hullMenu || currentModule?.oneOf) ? paints : [];

  return { mount, menu, currentItem, item, currentModule, actions, swatches, hullMenu, cargoMenu };
};

/**
 * Move focus in the current menu.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 * @param {Boolean} sub - Set by the alternate controls, which stay on one row.
 */
export const moveSelection = (delta, ship, sub) => {
  const { menu, currentModule, actions, swatches } = selectionOf(ship);

  if (!stage) {
    mountOption = Math.max(0, Math.min(menu.length, mountOption + delta));
  } else if (stage === 1) {
    moduleOption = Math.max(0, Math.min(menu.length, moduleOption + delta));
  } else {
    const first = actions.length + 1;
    const onPaints = focused >= first;

    // Down drops from the action row onto the paint row, landing on the colour
    // already worn, and up comes back off it. Any other move runs along the
    // row focus is already on
    if (!sub && onPaints && delta < 0) {
      focused = 0;
    } else if (!sub && !onPaints && delta > 0 && swatches.length) {
      focused = first + Math.max(0, swatches.indexOf(currentModule?.shades || ship.shades));
    } else if (onPaints) {
      focused = Math.max(first, Math.min(first + swatches.length - 1, focused + delta));
    } else {
      focused = Math.max(0, Math.min(actions.length, focused + delta));
    }
  }
};

/**
 * Move focus with the alternate directional controls, which run along the row
 * focus is on rather than between rows.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 */
export const moveSubSelection = (delta, ship) => moveSelection(delta, ship, 1);

/**
 * Step back out of the current docked menu.
 *
 * @returns {Boolean} handled - Whether there was a column to back out of.
 */
export const back = (ship) => {
  if (stage) {
    // The hull has nothing to pick out, so its actions are the whole submenu
    stage = mountOption === 1 ? 0 : stage - 1;
  } else {
    launch(ship);
  }
};

/**
 * Drill into the mount picked out, then the module picked out of its list,
 * then carry out the action picked from those possible for that module.
 *
 * @param {Object} ship
 */
export const confirmSelection = (ship) => {
  const { mount, menu, currentModule, actions, swatches, hullMenu, cargoMenu } = selectionOf(ship);

  if (!stage) {
    if (mountOption === menu.length) return back(ship);

    moduleOption = focused = 0;
    stage = mountOption === 1 ? 2 : 1;
    return;
  }

  if (stage === 1) {
    if (moduleOption === menu.length) return back(ship);
    focused = 0;
    stage = 2;
    return;
  }

  const picked = actions[focused];
  // The swatch row sits after the actions and their BACK button
  const shades = swatches[focused - actions.length - 1];

  if (shades) {
    currentModule.shades = shades;
    ship.segments
      .filter((segment) => hullMenu ? segment.hull : segment.module === currentModule)
      .forEach((segment) => segment.shades = shades);

    return;
  }

  if (!picked) return back(ship);

  if (picked === 'FIX') {
    hullMenu ? ship.fixHull() : mount.health = currentModule.health;
    return;
  }

  if (picked === 'SELL') {
    const [item, count] = cargoMenu ? menu[moduleOption] : [currentModule, 1];

    ship.modules = ship.modules.filter((module) => module !== item);
    ship.cargo = ship.cargo.filter((cargoItem) => cargoItem.item !== item);
    ship.credits += item.price * count;
    moduleOption = Math.min(moduleOption, (cargoMenu ? cargoOf(ship) : fitsOf(ship, mount)).length - 1);

    // A sale returns to the list, leaving its replacement row focused rather
    // than treating it as though the pilot had picked it.
    stage = 1;
    if (moduleOption < 0) moduleOption = 0;

    return;
  }

  if (picked === 'BUY') {
    if (!roomFor(ship)) {
      say('CARGO FULL');
    } else {
      ship.credits -= currentModule.price;
      ship.modules.push(instanceOf(currentModule));
    }
  } else {
    ship.fit(picked === 'EQUIP' && currentModule, mount);
  }
};

// A row's own background, and its highlight when it's the one picked out in
// its column. Appended digit is the fill's opacity
const renderButton = (ctx, x0, x1, y, focused, disabled) => {
  if (disabled) ctx.globalAlpha = 0.3;

  ctx.fillStyle = `${colors.purple[2]}${focused ? '' : '9'}`;
  ctx.strokeStyle = `${colors.violet[2]}${focused ? '' : '0'}`;
  ctx.fillRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  ctx.strokeRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  ctx.globalAlpha = 1;
};

/**
 * @param {Object} game
 * @param {Object} ship - The docked ship whose mounts are listed.
 */
export const renderDocked = (game, ship) => {
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
  const col0 = [outerPadding + padding, outerPadding + padding + colWidth];
  const col1 = [col0[1] + colGap, col0[1] + colGap + colWidth];

  const { mount, menu, currentItem, item, currentModule, actions, swatches, hullMenu, cargoMenu } = selectionOf(ship);
  const hulls = ship.segments.filter(({ hull }) => hull);
  const actionMenu = stage > 1;
  const currentHull = item === 'HULL';
  const cargoItems = item === 'CARGO' ? cargoOf(ship) : cargoMenu && stage && item && [item];
  const selected = (currentModule?.shades || ship.shades);
  const info = currentHull || cargoItems || currentModule || mount?.module;
  const health = currentHull ? hulls.reduce((total, { health }) => total + health, 0) : mount?.module === info ? mount?.health : info?.health;
  const maxHealth = currentHull ? ship.hullSegments.reduce((total, { health }) => total + health, 0) : info?.health;
  let actionX = 0;
  const actionButtons = [];
  // The action row, and the swatch row under it when there is paint to pick
  const extraRows = actionMenu + Boolean(swatches.length);
  const menuY = (i) => top + (i + (i > currentItem ? extraRows : 0)) * rowGap;
  const actionY = menuY(currentItem) + rowGap;
  const swatchX = col0[1] - swatchInset - swatchSize;

  [...actions, 'BACK'].forEach((item) => {
    const width = item.length * 13 * textSize + textPad * 2;

    actionButtons.push({ item, width, x: col0[0] + actionX, y: actionY });
    actionX += width + rowPad;
  });
  // Square buttons of their own on the row below, carrying on the same focus
  swatches.forEach((shades, i) => actionButtons.push({
    shades, width: rowGap - rowPad, x: col0[0] + i * rowGap, y: actionY + rowGap,
  }));

  ctx.save();
  ctx.scale(uiScale, uiScale);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(outerPadding, top - listInset, uiWidth - outerPadding * 2, height);

  menu.forEach((item, i) => {
    const y = menuY(i);

    renderButton(
      ctx,
      ...col0,
      y,
      !actionMenu && i === currentItem,
      actionMenu && i !== currentItem,
    );

    // One the pilot owns wears its paint on the right of its row, which tells
    // two scoops apart from each other and from the one on offer to buy
    if (item.oneOf) {
      ctx.fillStyle = (item.shades || ship.shades)[2];
      ctx.fillRect(swatchX, y - rowPad + swatchInset, swatchSize, swatchSize);
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
    actionButtons.forEach(({ shades, width, x, y }, i) => {
      renderButton(ctx, x, x + width, y, focused === i);

      // Appended digit is the fill's opacity, so a paint only on offer is a
      // wash inside its outline while the one worn is solid
      if (shades) {
        ctx.fillStyle = `${shades[2]}${shades === selected ? '' : '3'}`;
        ctx.strokeStyle = shades[2];
        ctx.fillRect(x + swatchInset, y - rowPad + swatchInset, swatchSize, swatchSize);
        ctx.strokeRect(x + swatchInset, y - rowPad + swatchInset, swatchSize, swatchSize);
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

  menu.forEach((item, i) => {
    let text = item.name;

    if (!stage || hullMenu) {
      if (i < 2) {
        text = item;
      } else {
        text = item.module?.name || '-EMPTY-';
      }
    } else if (cargoMenu) {
      text = cargoName(item);
    }

    renderText(
      game,
      text,
      col0[0] + textPad,
      menuY(i) + 2,
      textSize,
      actionMenu && i !== currentItem ? `${colors.violet[2]}6` : colors.violet[2],
    );
  });

  if (actionMenu) {
    actionButtons.forEach(({ item, x, y }) => item && renderText(
      game, item, x + textPad, y + 2, textSize, colors.violet[2],
    ));
  }

  if (!actionMenu || hullMenu) {
    renderText(
      game,
      stage && !hullMenu ? 'BACK' : 'EXIT',
      col0[0] + textPad,
      top + rowGap * 10 + 2,
      textSize,
      hullMenu ? `${colors.violet[2]}6` : colors.violet[2],
    );
  }

  if (info) {
    const labels = currentHull ?
        ['HULL', 'HP'] :
      cargoItems ?
          ['CARGO', ...cargoItems.map(cargoName)] :
          [info.name, 'HP', 'VALUE', 'PWR'];
    const values = currentHull ?
        [`${health | 0}/${maxHealth}`] :
      cargoItems ?
          [] :
          [`${health | 0}/${maxHealth}`, `$${info.price}`, info.powerUsage];

    labels.forEach((text, i) => renderText(
      game,
      text,
      col1[0] + textPad, top + (i ? (i + 1) * rowGap + 2 : (rowGap - 4) / 2),
      textSize,
      colors.violet[2],
    ));

    values.forEach((text, i) => renderText(
      game,
      text,
      col1[1] - textPad, top + (i + 2) * rowGap + 2,
      textSize,
      colors.violet[2],
      4,
    ));
  }
};
