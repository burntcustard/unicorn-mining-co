import { roomFor, say } from '../player';
import { colors } from '../colors';
import { forget } from '../game';
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

// Which mount is picked out, which of its fitting modules, and how far into
// picking one out the pilot has got: 0 browsing mounts, 1 browsing modules
// that fit the one picked out, 2 choosing an action for that module.
// Kept here rather than on the ship, since all of this is
// purely a UI focus over its mounts and not part of the ship itself
let mountOption = 0;
let moduleOption = 0;
let focused = 0;
let stage = 0;
let cargoMenu = 0;
let hullMenu = 0;

// Cargo instances carry their item data directly, and a stowed module is its
// own data, so collect like things into one menu entry with how many are aboard.
const cargoOf = (ship) => [...ship.cargoBay, ...ship.cargo.map(({ item }) => item)]
  .reduce((types, item) => {
    const type = types.find(([cargo]) => cargo === item);

    type ? type[1]++ : types.push([item, 1]);

    return types;
  }, []);

const hullActionsOf = (ship) => (ship.hullSegments.some((part) =>
  ship.segments.find(({ module }) => module === part)?.health !== part.health) && ['FIX']) || [];

// A module is bought into the cargo bay, fitted from there, and put back there
// when taken off, so a pilot can own several of a kind and hang each in one slot.
const actionsOf = (ship, mount, module) => {
  const fitted = mount.module === module;
  const stowed = ship.cargoBay.includes(module);

  return [
    fitted && mount.health < module.health && 'FIX',
    !fitted && !stowed && ship.credits >= module.price && 'BUY',
    !fitted && stowed && 'EQUIP',
    fitted && 'REMOVE',
    !fitted && stowed && 'SELL',
  ].filter(Boolean);
};

const menuActions = (ship, mount, module) => hullMenu ?
    hullActionsOf(ship) :
  cargoMenu ?
      ['SELL'] :
      actionsOf(ship, mount, module);

const moduleOf = (ship, mount) => hullMenu ?
  0 :
  cargoMenu ?
    cargoOf(ship)[moduleOption]?.[0] :
    mount?.fits[moduleOption];

/**
 * Move focus in the current menu.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 */
export const moveSelection = (delta, ship) => {
  const mounts = ship.slots;

  if (stage === 0) {
    mountOption = Math.max(0, Math.min(mounts.length + 2, mountOption + delta));
  } else if (stage === 1) {
    const menu = hullMenu ? [ship] : cargoMenu ? cargoOf(ship) : mounts[mountOption - 2].fits;

    moduleOption = Math.max(0, Math.min(menu.length, moduleOption + delta));
  } else {
    const mount = mounts[mountOption - 2];
    const module = moduleOf(ship, mount);
    const actions = menuActions(ship, mount, module);
    focused = Math.max(0, Math.min(actions.length, focused + delta));
  }
};

/**
 * Move focus with the alternate directional controls.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 */
export const moveSubSelection = moveSelection;

/**
 * Step back out of the current docked menu.
 *
 * @returns {Boolean} handled - Whether there was a column to back out of.
 */
export const back = (ship) => {
  if (stage) {
    // The hull has nothing to pick out, so its actions are the whole submenu
    stage = hullMenu ? 0 : stage - 1;
    if (!stage) cargoMenu = hullMenu = 0;
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
  const mount = ship.slots[mountOption - 2];

  if (!stage) {
    if (mountOption === ship.slots.length + 2) return back(ship);

    cargoMenu = mountOption === 0;
    hullMenu = mountOption === 1;
    moduleOption = focused = 0;
    stage = hullMenu ? 2 : 1;
    return;
  }

  if (stage === 1) {
    const menu = cargoMenu ? cargoOf(ship) : mount.fits;

    if (moduleOption === menu.length) return back(ship);
    focused = 0;
    stage = 2;
    return;
  }

  const currentModule = moduleOf(ship, mount);
  const actions = menuActions(ship, mount, currentModule);
  const picked = actions[focused];

  if (!picked) return back(ship);

  if (picked === 'FIX') {
    hullMenu ? ship.fixHull() : mount.health = currentModule.health;
    return;
  }

  if (cargoMenu) {
    const cargo = cargoOf(ship);
    const [item, count] = cargo[moduleOption];

    ship.cargoBay = ship.cargoBay.filter((stowed) => stowed !== item);
    ship.cargo = ship.cargo.filter((cargoItem) => cargoItem.item !== item);
    ship.credits += item.price * count;
    moduleOption = Math.min(moduleOption, cargoOf(ship).length - 1);

    if (moduleOption < 0) {
      moduleOption = 0;
      stage = 1;
    }

    return;
  }

  if (picked === 'BUY') {
    if (!roomFor(ship)) {
      say('CARGO FULL');
    } else {
      ship.credits -= currentModule.price;
      ship.cargoBay.push(currentModule);
    }
  } else if (picked === 'SELL') {
    ship.credits += currentModule.price;
    forget(ship.cargoBay, currentModule);
  } else if (picked === 'EQUIP') {
    if (mount.module) ship.cargoBay.push(mount.module);
    ship.unfit(mount);
    forget(ship.cargoBay, currentModule);
    ship.fit(currentModule, mount);
  } else if (picked === 'REMOVE') {
    ship.cargoBay.push(mount.module);
    ship.unfit(mount);
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
  const width = uiWidth - outerPadding * 2;
  const height = Math.max(
    uiHeight - outerPadding * 2,
    listInset + rowGap * 11 + padding - rowPad * 2,
  );
  const colWidth = (width - padding * 2 - colGap * 2) / 3;
  const top = (uiHeight - height) / 2 + listInset;

  // Left and right edges of the menu and information columns; the last third
  // is intentionally left empty for the next docked-menu feature.
  const col0 = [outerPadding + padding, outerPadding + padding + colWidth];
  const col1 = [col0[1] + colGap, col0[1] + colGap + colWidth];

  const mounts = ship.slots;
  const mount = mounts[mountOption - 2];
  const cargo = cargoOf(ship);
  const hulls = ship.segments.filter(({ hull }) => hull);
  const actionMenu = stage > 1;
  const menu = stage && !hullMenu ? cargoMenu ? cargo : mount?.fits : ['CARGO', 'HULL', ...mounts];
  const currentItem = hullMenu ? mountOption : [mountOption, moduleOption, moduleOption][stage];
  const item = menu[currentItem];
  const currentModule = !hullMenu && !cargoMenu && stage && item;
  const currentHull = item === 'HULL';
  const cargoItems = item === 'CARGO' ? cargo : cargoMenu && stage && item && [item];
  const actions = actionMenu ? menuActions(ship, mount, currentModule) : [];
  const info = currentHull || cargoItems || currentModule || mount?.module;
  const health = currentHull ? hulls.reduce((total, { health }) => total + health, 0) : mount?.module === info ? mount?.health : info?.health;
  const maxHealth = currentHull ? ship.hullSegments.reduce((total, { health }) => total + health, 0) : info?.health;
  const bottom = top + rowGap * 10;
  let actionX = 0;
  const actionButtons = [];

  [...actions, 'BACK'].forEach((item) => {
    const width = item.length * 13 * textSize + textPad * 2;

    actionButtons.push({ item, width, x: actionX });
    actionX += width + rowPad;
  });
  const menuY = (i) => top + (i + (i > currentItem ? actionMenu : 0)) * rowGap;
  const disabledText = `${colors.violet[2]}6`;

  ctx.save();
  ctx.scale(uiScale, uiScale);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(outerPadding, top - listInset, width, height);

  menu.forEach((_, i) => {
    const disabled = actionMenu && i !== currentItem;

    renderButton(ctx, ...col0, menuY(i), !actionMenu && i === currentItem, disabled);
  });
  if (!actionMenu || hullMenu) renderButton(ctx, ...col0, bottom, !hullMenu && currentItem === menu.length, hullMenu);

  if (actionMenu) {
    const actionY = menuY(currentItem) + rowGap;

    actionButtons.forEach((button, i) => {
      renderButton(
        ctx, col0[0] + button.x, col0[0] + button.x + button.width,
        actionY,
        focused === i,
      );
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
      text = `${item[0].name} *${item[1]}`;
    }

    renderText(game, text, col0[0] + textPad, menuY(i) + 2, textSize, actionMenu && i !== currentItem ? disabledText : colors.violet[2]);
  });

  if (actionMenu) {
    actionButtons.forEach((button) => {
      renderText(
        game, button.item, col0[0] + button.x + textPad,
        menuY(currentItem) + rowGap + 2, textSize, colors.violet[2],
      );
    });
  }

  if (!actionMenu || hullMenu) renderText(game, hullMenu ? 'EXIT' : stage ? 'BACK' : 'EXIT', col0[0] + textPad, bottom + 2, textSize, hullMenu ? disabledText : colors.violet[2]);

  if (info) {
    const labels = currentHull ?
        ['HULL', 'HP'] :
      cargoItems ?
          ['CARGO', ...cargoItems.map(([item, count]) => `${item.name} *${count}`)] :
          [info.name, 'HP', 'VALUE', 'PWR'];
    const values = currentHull ?
        [`${health | 0}/${maxHealth}`] :
      cargoItems ?
          [] :
          [`${health | 0}/${maxHealth}`, `$${info.price}`, info.powerUsage];

    labels.forEach((text, i) => renderText(
      game, text, col1[0] + textPad, top + (i ? (i + 1) * rowGap + 2 : (rowGap - 4) / 2), textSize, colors.violet[2],
    ));

    values.forEach((text, i) => renderText(
      game, text, col1[1] - textPad, top + (i + 2) * rowGap + 2, textSize, colors.violet[2], 4,
    ));
  }
};
