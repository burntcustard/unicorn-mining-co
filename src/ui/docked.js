import { roomFor, say } from '../player';
import { colors } from '../colors';
import { forget } from '../game';
import { launch } from '../docking';
import { renderText } from '../text';

const fill = 0.8;

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

const paints = Object.values(colors).filter((_, i) => i - 5 && i - 7 && i - 9);

// Which mount is picked out, which of its fitting modules, and how far into
// picking one out the pilot has got: 0 browsing mounts, 1 browsing modules
// that fit the one picked out, 2 choosing an action or paint for that module.
// Kept here rather than on the ship, since all of this is
// purely a UI focus over its mounts and not part of the ship itself
let mountOption = 0;
let moduleOption = 0;
let focused = 0;
let actionFocus = 0;
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
    fitted && 'SELL',
  ].filter(Boolean);
};

// Paint is kept per mount, so there is only something to colour once this slot
// is the one wearing the module
const paintsOf = (mount, module) => hullMenu || mount.module === module ? paints : [];

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
    const module = hullMenu ? 0 : cargoMenu ? cargoOf(ship)[moduleOption]?.[0] : mount.fits[moduleOption];
    const actions = hullMenu ? hullActionsOf(ship) : cargoMenu ? ['SELL'] : actionsOf(ship, mount, module);
    const swatches = cargoMenu ? [] : paintsOf(mount, module);
    const backFocus = actions.length + swatches.length;

    if (focused === backFocus) {
      if (delta < 0) focused = swatches.length ? actions.length : actionFocus;
    } else if (focused >= actions.length) {
      focused = delta > 0 ? backFocus : actionFocus;
    } else if (delta > 0 && swatches.length) {
      const shades = module.paints?.[ship.mounts.indexOf(mount)] || module.shades || ship.shades;

      focused = actions.length + Math.max(0, swatches.indexOf(shades));
    } else if (delta > 0) {
      focused = backFocus;
    }
  }
};

/**
 * Move focus through the inline module actions and paint swatches.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 */
export const moveSubSelection = (delta, ship) => {
  if (stage !== 2) return;

  const mounts = ship.slots;
  const mount = mounts[mountOption - 2];
  const module = hullMenu ? 0 : cargoMenu ? cargoOf(ship)[moduleOption]?.[0] : mount.fits[moduleOption];
  const actions = hullMenu ? hullActionsOf(ship) : cargoMenu ? ['SELL'] : actionsOf(ship, mount, module);
  const firstSwatch = actions.length;
  const lastSwatch = firstSwatch + (cargoMenu ? [] : paintsOf(mount, module)).length - 1;

  if (focused < actions.length) {
    focused = Math.max(0, Math.min(actions.length - 1, focused + delta));
    actionFocus = focused;
  } else if (focused <= lastSwatch) {
    focused = Math.max(firstSwatch, Math.min(lastSwatch, focused + delta));
  }
};

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
  } else if (ship) {
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
  const cargo = cargoOf(ship);

  if (stage === 0 && mountOption === ship.slots.length + 2) {
    back(ship);
    return;
  }

  const currentModule = hullMenu ? 0 : cargoMenu ? cargo[moduleOption]?.[0] : mount?.fits[moduleOption];
  const actions = stage === 2 ? hullMenu ? hullActionsOf(ship) : cargoMenu ? ['SELL'] : actionsOf(ship, mount, currentModule) : [];
  const swatches = stage === 2 && !cargoMenu ? paintsOf(mount, currentModule) : [];
  const menu = stage ? hullMenu ? [ship] : cargoMenu ? cargo : mount.fits : ['CARGO', 'HULL', ...ship.slots];
  const backFocus = actions.length + swatches.length;
  const focusedItem = [mountOption, moduleOption, focused][stage];

  if (stage === 2 && focused === backFocus) {
    back(ship);
    return;
  }

  if (stage < 2 && focusedItem === menu.length) {
    back(ship);
    return;
  }

  if (stage === 0) {
    cargoMenu = mountOption === 0;
    hullMenu = mountOption === 1;
    moduleOption = actionFocus = focused = 0;
    if (!hullMenu && !cargoMenu) moduleOption = Math.max(0, mount.fits.indexOf(mount.module));
    stage = hullMenu ? 2 : 1;
  } else if (stage === 1) {
    actionFocus = focused = 0;
    if (hullMenu || cargoMenu || actionsOf(ship, mount, currentModule).length || paintsOf(mount, currentModule).length) stage = 2;
  } else if (stage === 2) {
    const picked = actions[focused];

    if (picked === 'FIX') {
      if (!hullMenu && mount.module !== currentModule) return;

      if (hullMenu) {
        ship.fixHull();
      } else {
        mount.health = currentModule.health;
      }

      return;
    }

    if (cargoMenu && picked === 'SELL') {
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

    if (!picked) {
      const shades = swatches[focused - actions.length];

      if (hullMenu) {
        ship.shades = shades;
        ship.segments.filter(({ hull }) => hull).forEach((segment) => segment.shades = shades);
      } else {
        (currentModule.paints ||= [])[ship.mounts.indexOf(mount)] = shades;

        mount.segments.forEach((segment) => segment.shades = shades);
      }

      return;
    } else if (picked === 'BUY') {
      if (!roomFor(ship)) {
        say('CARGO FULL');
      } else {
        ship.credits -= currentModule.price;
        ship.cargoBay.push(currentModule);
      }
    } else if (picked === 'SELL') {
      ship.credits += currentModule.price;
      ship.unfit(mount);
    } else if (picked === 'EQUIP') {
      if (mount.module) ship.cargoBay.push(mount.module);
      ship.unfit(mount);
      forget(ship.cargoBay, currentModule);
      ship.fit(currentModule, mount);
    } else if (picked === 'REMOVE') {
      ship.cargoBay.push(mount.module);
      ship.unfit(mount);
    }

    // Parting with a module takes actions and paints away with it, so the
    // focus has to come back to whatever is left rather than sit past the end
    focused = actionFocus = Math.max(0, Math.min(focused, actionsOf(ship, mount, currentModule).length - 1));
  }
};

// A row's own background, and its highlight when it's the one picked out in
// its column. Appended digit is the fill's opacity
const renderButton = (ctx, x0, x1, y, isCurrent, isFocused = isCurrent, disabled) => {
  if (disabled) ctx.globalAlpha = 0.3;
  ctx.fillStyle = `${colors.purple[2]}${isCurrent ? '' : '8'}`;
  ctx.fillRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);

  if (isFocused && !disabled) {
    ctx.strokeStyle = `${colors.violet[0]}a`;
    ctx.strokeRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  }

  if (disabled) ctx.globalAlpha = 1;
};

const layoutButtons = (items, widthOf) => {
  let x = 0;

  return items.map((item) => {
    const buttonWidth = widthOf(item);

    const button = { item, width: buttonWidth, x };

    x += buttonWidth + rowPad;
    return button;
  });
};

/**
 * @param {Object} game
 * @param {Object} ship - The docked ship whose mounts are listed.
 */
export const renderDocked = (game, ship) => {
  const { ctx, uiScale, uiWidth, uiHeight } = game;
  const width = uiWidth * fill;
  const height = uiHeight * fill;
  const panelLeft = (uiWidth - width) / 2;
  const colWidth = (width - listInset * 2 - colGap * 2) / 3;
  const top = (uiHeight - height) / 2 + listInset;

  // Left and right edges of the menu and information columns; the last third
  // is intentionally left empty for the next docked-menu feature.
  const col0 = [panelLeft + listInset, panelLeft + listInset + colWidth];
  const col1 = [col0[1] + colGap, col0[1] + colGap + colWidth];

  const mounts = ship.slots;
  const mount = mounts[mountOption - 2];
  const cargo = cargoOf(ship);
  const hulls = ship.segments.filter(({ hull }) => hull);
  const menu = stage ? hullMenu ? ['HULL'] : cargoMenu ? cargo : mount?.fits : ['CARGO', 'HULL', ...mounts];
  const currentItem = [mountOption, moduleOption, moduleOption][stage];
  const item = menu[currentItem];
  const currentModule = !hullMenu && !cargoMenu && stage && item;
  const currentHull = item === 'HULL';
  const currentCargo = item === 'CARGO' ? cargo[0] : cargoMenu && stage && item;
  const actions = stage === 2 ? hullMenu ? hullActionsOf(ship) : cargoMenu ? ['SELL'] : actionsOf(ship, mount, currentModule) : [];
  const swatches = stage === 2 && !cargoMenu ? paintsOf(mount, currentModule) : [];
  const backFocus = actions.length + swatches.length;
  const info = currentHull || currentCargo?.[0] || currentModule || mount?.module;
  const fitted = mount?.module === info;
  const health = currentHull ? hulls.reduce((total, { health }) => total + health, 0) : fitted ? mount?.health : info?.health;
  const maxHealth = currentHull ? ship.hullSegments.reduce((total, { health }) => total + health, 0) : info?.health;
  const infoRows = currentHull || currentCargo ? 2 : 4;
  const bottom = uiHeight / 2 + height / 2 - listInset - rowGap;
  const actionButtons = layoutButtons(actions, (name) => name.length * 13 * textSize + textPad * 2);
  const swatchButtons = layoutButtons(swatches, () => rowGap - rowPad);
  const extraRows = stage === 2 ? Boolean(actions.length) + Boolean(swatches.length) + 1 : 0;
  const menuY = (i) => top + (i + (i > moduleOption ? extraRows : 0)) * rowGap;
  const selectedShades = (hullMenu && ship.shades) || currentModule?.paints?.[ship.mounts.indexOf(mount)] || currentModule?.shades || ship.shades;
  const disabledText = `${colors.violet[2]}6`;

  ctx.save();
  ctx.scale(uiScale, uiScale);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(panelLeft, top - listInset, width, height);

  menu.forEach((_, i) => {
    const disabled = stage === 2 && i !== moduleOption;

    renderButton(ctx, ...col0, menuY(i), i === currentItem, stage !== 2 && i === currentItem, disabled);
  });
  if (stage !== 2) renderButton(ctx, ...col0, bottom, currentItem === menu.length);

  if (stage === 2) {
    const actionY = menuY(moduleOption) + rowGap;
    const backY = menuY(moduleOption) + extraRows * rowGap;

    actionButtons.forEach((button, i) => {
      renderButton(
        ctx, col0[0] + button.x, col0[0] + button.x + button.width,
        actionY,
        focused === i,
        focused === i,
      );
    });
    swatchButtons.forEach((button, i) => {
      const y = actionY + Boolean(actions.length) * rowGap;

      renderButton(
        ctx, col0[0] + button.x, col0[0] + button.x + button.width, y,
        button.item === selectedShades, focused === i + actions.length,
      );
      ctx.fillStyle = button.item[2];
      ctx.fillRect(col0[0] + button.x + rowPad, y, button.width - rowPad * 2, rowGap - rowPad * 3);
    });
    renderButton(ctx, col0[0], col0[0] + 13 * 4 * textSize + textPad * 2,
      backY, focused === backFocus, focused === backFocus);
  }

  if (info) {
    ctx.fillStyle = `${colors.purple[2]}8`;
    ctx.fillRect(col1[0], top - rowPad, colWidth, rowGap * infoRows);
    ctx.strokeStyle = `${colors.violet[2]}c`;
    ctx.beginPath();
    ctx.moveTo(col1[0], top + rowGap - rowPad);
    ctx.lineTo(col1[1], top + rowGap - rowPad);
    ctx.stroke();
  }

  ctx.restore();

  menu.forEach((item, i) => {
    let text = item.name;

    if (stage === 0) {
      if (i < 2) {
        text = item;
      } else {
        text = item.module?.name || '-EMPTY-';
      }
    } else if (hullMenu) {
      text = 'HULL';
    } else if (cargoMenu) {
      text = `${item[0].name} *${item[1]}`;
    }

    renderText(game, text, col0[0] + textPad, menuY(i) + 2, textSize, stage === 2 && i !== moduleOption ? disabledText : colors.violet[2]);
  });

  if (stage === 2) {
    actionButtons.forEach((button) => {
      renderText(
        game, button.item, col0[0] + button.x + textPad,
        menuY(moduleOption) + rowGap + 2, textSize, colors.violet[2],
      );
    });
    renderText(game, 'BACK', col0[0] + textPad,
      menuY(moduleOption) + extraRows * rowGap + 2, textSize, colors.violet[2]);
  }

  if (stage !== 2) renderText(game, stage ? 'BACK' : 'EXIT', col0[0] + textPad, bottom + 2, textSize, colors.violet[2]);

  if (info) {
    const labels = currentHull ?
        ['HULL', 'HP'] :
      currentCargo ?
          [info.name, 'VALUE'] :
          [info.name, 'HP', 'VALUE', 'PWR'];
    const values = currentHull ?
        [`${health | 0}/${maxHealth}`] :
      currentCargo ?
          [`$${info.price * currentCargo[1]}`] :
          [`${health | 0}/${maxHealth}`, `$${info.price}`, info.powerUsage];

    labels.forEach((text, i) => renderText(
      game, text, col1[0] + textPad, top + i * rowGap + 2, textSize, colors.violet[2],
    ));

    values.forEach((text, i) => renderText(
      game, text, col1[1] - textPad, top + (i + 1) * rowGap + 2, textSize, colors.violet[2], 4,
    ));
  }
};
