import { roomFor, say } from '../player';
import { colors } from '../colors';
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

    if (type) {
      type[1]++;
    } else {
      types.push([item, 1]);
    }

    return types;
  }, []);

// A module is bought into the cargo bay, fitted from there, and put back there
// when taken off, so a pilot can own several of a kind and hang each in one slot.
const actionsOf = (ship, mount, module) => {
  const fitted = mount.module === module;

  return [
    !fitted && ship.credits >= module.price && 'BUY',
    !fitted && ship.cargoBay.includes(module) && 'EQUIP',
    fitted && 'REMOVE',
    fitted && 'SELL',
  ].filter(Boolean);
};

// Paint is kept per mount, so there is only something to colour once this slot
// is the one wearing the module
const paintsOf = (mount, module) => mount.module === module ? paints : [];

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
    const menu = hullMenu ? [ship] : cargoMenu ? cargoOf(ship) : mounts[mountOption].fits;

    moduleOption = Math.max(0, Math.min(menu.length, moduleOption + delta));
  } else {
    const mount = mounts[mountOption];
    const module = hullMenu ? 0 : cargoMenu ? cargoOf(ship)[moduleOption]?.[0] : mount.fits[moduleOption];
    const actions = hullMenu ? ['FIX'] : cargoMenu ? ['SELL'] : actionsOf(ship, mount, module);
    const swatches = hullMenu || cargoMenu ? [] : paintsOf(mount, module);

    if (focused > actions.length) {
      if (delta < 0) focused = actionFocus;
    } else if (delta > 0 && swatches.length) {
      const shades = module.paints?.[ship.mounts.indexOf(mount)] || module.shades || ship.shades;

      focused = actions.length + 1 + Math.max(0, swatches.indexOf(shades));
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
  const mount = mounts[mountOption];
  const module = hullMenu ? 0 : cargoMenu ? cargoOf(ship)[moduleOption]?.[0] : mount.fits[moduleOption];
  const actions = hullMenu ? ['FIX'] : cargoMenu ? ['SELL'] : actionsOf(ship, mount, module);
  const firstSwatch = actions.length + 1;
  const lastSwatch = firstSwatch + (hullMenu || cargoMenu ? 0 : paintsOf(mount, module).length) - 1;

  if (focused <= actions.length) {
    focused = Math.max(0, Math.min(actions.length, focused + delta));
    actionFocus = focused;
  } else {
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
  const mount = ship.slots[mountOption];
  const cargo = cargoOf(ship);

  if (stage === 0 && mountOption === ship.slots.length + 2) {
    back(ship);
    return;
  }

  const currentModule = hullMenu ? 0 : cargoMenu ? cargo[moduleOption]?.[0] : mount?.fits[moduleOption];
  const actions = stage === 2 ? hullMenu ? ['FIX'] : cargoMenu ? ['SELL'] : actionsOf(ship, mount, currentModule) : [];
  const swatches = stage === 2 && !hullMenu && !cargoMenu ? paintsOf(mount, currentModule) : [];
  const menu = stage ? hullMenu ? [ship] : cargoMenu ? cargo : mount.fits : [...ship.slots, 'HULL', 'CARGO'];
  const focusedItem = [mountOption, moduleOption, focused][stage];

  if (stage === 2 && focused === actions.length) {
    back(ship);
    return;
  }

  if (stage < 2 && focusedItem === menu.length) {
    back(ship);
    return;
  }

  if (stage === 0) {
    hullMenu = mountOption === ship.slots.length;
    cargoMenu = mountOption === ship.slots.length + 1;
    moduleOption = actionFocus = focused = 0;
    if (!hullMenu && !cargoMenu) moduleOption = Math.max(0, mount.fits.indexOf(mount.module));
    stage = hullMenu ? 2 : 1;
  } else if (stage === 1) {
    actionFocus = focused = 0;
    if (hullMenu || cargoMenu || actionsOf(ship, mount, currentModule).length || paintsOf(mount, currentModule).length) stage = 2;
  } else if (stage === 2) {
    const picked = actions[focused];

    if (hullMenu && picked === 'FIX') {
      ship.fixHull();
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
      const shades = swatches[focused - actions.length - 1];

      (currentModule.paints ||= [])[ship.mounts.indexOf(mount)] = shades;

      if (mount.module === currentModule) {
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
      ship.cargoBay.splice(ship.cargoBay.indexOf(currentModule), 1);
      ship.fit(currentModule, mount);
    } else if (picked === 'REMOVE') {
      ship.cargoBay.push(mount.module);
      ship.unfit(mount);
    }

    // Parting with a module takes actions and paints away with it, so the
    // focus has to come back to whatever is left rather than sit past the end
    focused = actionFocus = Math.min(focused, actionsOf(ship, mount, currentModule).length);
  }
};

// A row's own background, and its highlight when it's the one picked out in
// its column. Appended digit is the fill's opacity
const renderButton = (ctx, x0, x1, y, isCurrent, isFocused = isCurrent) => {
  ctx.fillStyle = `${colors.purple[2]}${isCurrent ? '' : '8'}`;
  ctx.fillRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);

  if (isFocused) {
    ctx.strokeStyle = `${colors.violet[0]}a`;
    ctx.strokeRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  }
};

const layoutButtons = (items, widthOf, width) => {
  let x = 0;
  let rows = 0;

  const buttons = items.map((item) => {
    const buttonWidth = Math.min(width, widthOf(item));

    if (x && x + buttonWidth > width) {
      x = 0;
      rows++;
    }

    const button = { item, width: buttonWidth, x, y: rows };

    x += buttonWidth + rowPad;
    return button;
  });

  return { buttons, rows: rows + Boolean(items.length) };
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

  ctx.save();
  ctx.scale(uiScale, uiScale);
  ctx.translate(uiWidth / 2, uiHeight / 2);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();

  const mounts = ship.slots;
  const mount = mounts[mountOption];
  const cargo = cargoOf(ship);
  const hulls = ship.segments.filter(({ hull }) => hull);
  const currentModule = !hullMenu && !cargoMenu && stage && mount?.fits[moduleOption];
  const currentHull = hullMenu && stage && hulls;
  const currentCargo = cargoMenu && stage && cargo[moduleOption];
  const actions = stage === 2 ? hullMenu ? ['FIX'] : cargoMenu ? ['SELL'] : actionsOf(ship, mount, currentModule) : [];
  const swatches = stage === 2 && !hullMenu && !cargoMenu ? paintsOf(mount, currentModule) : [];
  const menu = stage ? hullMenu ? ['HULL'] : cargoMenu ? cargo : mount?.fits : [...mounts, 'HULL', 'CARGO'];
  const currentItem = [mountOption, moduleOption, moduleOption][stage];
  const info = currentHull || currentCargo?.[0] || currentModule || mount?.module;
  const health = mount?.module === info ? mount?.health : info?.health;
  const hullHealth = hulls.reduce((total, { health }) => total + health, 0);
  const hullMaxHealth = ship.hullSegments.reduce((total, { health }) => total + health, 0);
  const infoRows = currentHull || currentCargo ? 2 : 4;
  const bottom = uiHeight / 2 + height / 2 - listInset - rowGap;
  const actionButtons = layoutButtons([...actions, 'BACK'], (name) => name.length * 13 * textSize + textPad * 2, colWidth);
  const swatchButtons = layoutButtons(swatches, () => rowGap - rowPad, colWidth);
  const extraRows = stage === 2 ? actionButtons.rows + swatchButtons.rows : 0;
  const menuY = (i) => top + (i + (i > moduleOption ? extraRows : 0)) * rowGap;
  const selectedShades = currentModule?.paints?.[ship.mounts.indexOf(mount)] || currentModule?.shades || ship.shades;

  ctx.save();
  ctx.scale(uiScale, uiScale);

  menu.forEach((_, i) => {
    ctx.globalAlpha = stage === 2 && i !== moduleOption ? 0.3 : 1;
    renderButton(ctx, ...col0, menuY(i), i === currentItem, stage !== 2 && i === currentItem);
  });
  ctx.globalAlpha = stage === 2 ? 0.3 : 1;
  renderButton(ctx, ...col0, bottom, currentItem === menu.length);
  ctx.globalAlpha = 1;

  if (stage === 2) {
    actionButtons.buttons.forEach((button, i) => renderButton(
      ctx, col0[0] + button.x, col0[0] + button.x + button.width,
      menuY(moduleOption) + (button.y + 1) * rowGap, focused === i,
    ));
    swatchButtons.buttons.forEach((button, i) => {
      const y = menuY(moduleOption) + (actionButtons.rows + button.y + 1) * rowGap;

      renderButton(
        ctx, col0[0] + button.x, col0[0] + button.x + button.width, y,
        button.item === selectedShades, focused === i + actions.length + 1,
      );
      ctx.fillStyle = button.item[2];
      ctx.fillRect(col0[0] + button.x + rowPad, y, button.width - rowPad * 2, rowGap - rowPad * 3);
    });
  }

  if (info) {
    ctx.fillStyle = `${colors.purple[2]}c`;
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
      if (i === mounts.length) {
        text = 'HULL';
      } else if (i === mounts.length + 1) {
        text = 'CARGO';
      } else {
        text = `${i}:${item.module?.name || '-EMPTY-'}`;
      }
    } else if (hullMenu) {
      text = 'HULL';
    } else if (cargoMenu) {
      text = `${item[0].name} *${item[1]}`;
    }

    ctx.globalAlpha = stage === 2 && i !== moduleOption ? 0.3 : 1;
    renderText(game, text, col0[0] + textPad, menuY(i) + 2, textSize, colors.violet[2]);
  });
  ctx.globalAlpha = 1;

  if (stage === 2) {
    actionButtons.buttons.forEach((button) => renderText(
      game, button.item, col0[0] + button.x + textPad,
      menuY(moduleOption) + (button.y + 1) * rowGap + 2, textSize, colors.violet[2],
    ));
  }

  ctx.globalAlpha = stage === 2 ? 0.3 : 1;
  renderText(game, stage ? 'BACK' : 'EXIT', col0[0] + textPad, bottom + 2, textSize, colors.violet[2]);
  ctx.globalAlpha = 1;

  if (info) {
    const labels = currentHull ?
        ['HULL', 'HP'] :
      currentCargo ?
          [info.name, 'VALUE'] :
          [info.name, 'HP', 'VALUE', 'PWR'];
    const values = currentHull ?
        [`${Math.floor(hullHealth)}/${hullMaxHealth}`] :
      currentCargo ?
          [`$${info.price * currentCargo[1]}`] :
          [`${Math.floor(health)}/${info.health}`, `$${info.price}`, info.powerUsage];

    labels.forEach((text, i) => renderText(
      game, text, col1[0] + textPad, top + i * rowGap + 2, textSize, colors.violet[2],
    ));

    values.forEach((text, i) => renderText(
      game, text, col1[1] - textPad, top + (i + 1) * rowGap + 2, textSize, colors.violet[2], 4,
    ));
  }
};
