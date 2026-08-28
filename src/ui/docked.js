import { earn, player, spend } from '../player';
import { colors } from '../colors';
import { launch } from '../docking';
import { renderText } from '../text';

/**
 * The panel shown over everything while a ship sits in a bay: a plain
 * rectangle split into three columns, dimmed out behind it so the panel reads
 * as the only thing worth looking at.
 *
 * The first column always lists the ship's mounts. Picking one out with
 * `SPACE` opens the second column, listing every module that fits there.
 * Picking one of those out in turn opens the third, listing whichever actions
 * are possible for that module.
 */
// How much of the screen the panel fills
const fill = 0.8;

// How far the list of mounts sits in from the panel's own edges, how far
// each row drops below the last, how big its text is, and how far a column
// sits in from its neighbour
const listInset = 40;
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
// that fit the one picked out, 2 choosing an available action for that module,
// 3 choosing its paint.
// Kept here rather than on the ship, since all of this is
// purely a UI cursor over its mounts and not part of the ship itself
let selected = 0;
let option = 0;
let action = 0;
let paint = 0;
let stage = 0;

const actionsOf = (ship, mount, module) => {
  const owned = module.owned;
  const equipped = ship.slots.some(({ module: fitted }) => fitted === module);

  return [
    !owned && player.credits >= module.price && 'BUY',
    owned && mount.module !== module && 'EQUIP',
    owned && 'PAINT',
    owned && (!equipped || mount.module === module) && 'SELL',
    mount.module === module && 'REMOVE',
  ].filter(Boolean);
};

/**
 * Move whichever column's cursor is currently live: the mount list while
 * still browsing it, or the module list once a mount has been opened.
 *
 * @param {Number} delta - -1 or 1.
 * @param {Object} ship
 */
export const moveSelection = (delta, ship) => {
  const mounts = ship.slots;

  if (stage === 0) {
    selected = Math.max(0, Math.min(mounts.length - 1, selected + delta));
  } else if (stage === 1) {
    const fits = mounts[selected].fits;

    option = Math.max(0, Math.min(fits.length - 1, option + delta));
  } else {
    const mount = mounts[selected];
    const actions = stage === 3 ? paints : actionsOf(ship, mount, mount.fits[option]);
    const current = stage === 3 ? paint : action;

    if (stage === 3) {
      paint = Math.max(0, Math.min(actions.length - 1, current + delta));
    } else {
      action = Math.max(0, Math.min(actions.length - 1, current + delta));
    }
  }
};

/**
 * Step back out a column rather than undocking, while there's one to step
 * back out of.
 *
 * @returns {Boolean} handled - Whether there was a column to back out of.
 */
export const back = (ship) => stage ? stage-- : ship && launch(ship);

/**
 * Drill into the mount picked out, then the module picked out of its list,
 * then carry out the action picked from those possible for that module.
 *
 * @param {Object} ship
 */
export const confirmSelection = (ship) => {
  const mount = ship.slots[selected];

  if (stage === 0) {
    option = Math.max(0, mount.fits.indexOf(mount.module));
    stage = 1;
  } else if (stage === 1) {
    action = 0;
    if (actionsOf(ship, mount, mount.fits[option]).length) stage = 2;
  } else if (stage === 2) {
    const chosen = mount.fits[option];
    const picked = actionsOf(ship, mount, chosen)[action];

    if (picked === 'PAINT') {
      const shades = chosen.paints?.[ship.mounts.indexOf(mount)] || chosen.shades || ship.shades;

      paint = Math.max(0, paints.indexOf(shades));
      stage = 3;
      return;
    } else if (picked === 'BUY') {
      if (spend(chosen.price)) {
        chosen.owned = 1;
        if (mount.module) ship.unfit(mount);
        ship.fit(chosen, mount);
      }
    } else if (picked === 'SELL') {
      if (mount.module === chosen) ship.unfit(mount);
      earn(chosen.price);
      chosen.owned--;
    } else if (picked === 'EQUIP') {
      if (mount.module) ship.unfit(mount);
      ship.fit(chosen, mount);
    } else if (picked === 'REMOVE') {
      ship.unfit(mount);
    }

    stage = 1;
  } else {
    const chosen = mount.fits[option];
    const shades = paints[paint];

    (chosen.paints ||= [])[ship.mounts.indexOf(mount)] = shades;

    if (mount.module === chosen) {
      mount.segments.forEach((segment) => segment.shades = shades);
    }

    stage = 1;
  }
};

// A row's own background, and its highlight when it's the one picked out in
// its column. Appended digit is the fill's opacity
const renderRow = (ctx, x0, x1, y, isSelected) => {
  ctx.fillStyle = `${isSelected ? colors.violet[3] : colors.purple[2]}c`;
  ctx.fillRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);

  if (isSelected) {
    ctx.strokeStyle = `${colors.violet[2]}c`;
    ctx.strokeRect(x0, y - rowPad, x1 - x0, rowGap - rowPad);
  }
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
  const paintWidth = rowGap - rowPad;
  const colWidth = (width - listInset * 2 - colGap * 3 - paintWidth) / 3;
  const top = (uiHeight - height) / 2 + listInset;

  // Left and right edges of the three text columns and narrow paint column
  const col0 = [panelLeft + listInset, panelLeft + listInset + colWidth];
  const col1 = [col0[1] + colGap, col0[1] + colGap + colWidth];
  const col2 = [col1[1] + colGap, col1[1] + colGap + colWidth];
  const col3 = [col2[1] + colGap, col2[1] + colGap + paintWidth];

  ctx.save();
  ctx.scale(uiScale, uiScale);
  ctx.translate(uiWidth / 2, uiHeight / 2);
  // Appended digit is the fill's opacity, so the world still shows through
  ctx.fillStyle = `${colors.purple[0]}c`;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();

  const mounts = ship.slots;
  const mount = mounts[selected];
  const actions = stage >= 2 && actionsOf(ship, mount, mount.fits[option]);

  ctx.save();
  ctx.scale(uiScale, uiScale);

  mounts.forEach((_, i) => renderRow(ctx, ...col0, top + i * rowGap, i === selected));

  if (stage >= 1) {
    mount.fits.forEach((_, i) => renderRow(ctx, ...col1, top + i * rowGap, i === option));
  }

  if (stage >= 2) {
    actions.forEach((_, i) => renderRow(ctx, ...col2, top + i * rowGap, i === action));
  }

  if (stage === 3) {
    paints.forEach((shades, i) => {
      const y = top + i * rowGap;

      renderRow(ctx, ...col3, y, i === paint);
      ctx.fillStyle = shades[2];
      ctx.fillRect(col3[0] + rowPad, y, rowGap - rowPad * 3, rowGap - rowPad * 3);
    });
  }

  ctx.restore();

  mounts.forEach((rowMount, i) => {
    renderText({
      color: colors.violet[2],
      game,
      size: textSize,
      text: rowMount.module?.name || '-EMPTY-',
      x: col0[0] + textPad,
      y: top + i * rowGap + 2,
    });
  });

  if (stage >= 1) {
    mount.fits.forEach((module, i) => {
      renderText({
        color: colors.violet[2],
        game,
        size: textSize,
        text: module.name,
        x: col1[0] + textPad,
        y: top + i * rowGap + 2,
      });
    });
  }

  if (stage >= 2) {
    const chosen = mount.fits[option];

    actions.forEach((name, i) => {
      renderText({
        color: colors.violet[2],
        game,
        size: textSize,
        text: `${name}${name === 'BUY' || name === 'SELL' ? ` $${chosen.price}` : ''}`,
        x: col2[0] + textPad,
        y: top + i * rowGap + 2,
      });
    });
  }

  renderText({
    color: colors.violet[2],
    game,
    size: 0.5,
    text: 'ESC',
    x: panelLeft + 10,
    y: uiHeight / 2 - height / 2 + 10,
  });
};
