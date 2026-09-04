import { colors } from '../colors';
import { renderText } from '../text';

/**
 * The bottom-right readout of the ship's modules, after the fashion of an Elite
 * cockpit panel: every module the ship carries, listed by name, with a box
 * beside each one the pilot can switch that fills in blue while it runs. The
 * key that works a module is underlined in its name. It only shows state and is
 * never read from: the keyboard still does the toggling.
 */

// How big the panel text is against the demo text, and the width of one glyph
// and the height of one line at that size
const textSize = 0.5;
const glyph = 13 * textSize;
const lineHeight = 15 * textSize;

// How far the panel sits in from the corner, how far one row drops below the
// last, the size of a module's swatch and the gap from it to the name beside it
const inset = 16;
const rowGap = 15;
const box = 8;
const gap = 6;

// How far in from each side of a letter its key-underline is drawn, and how far
// below the row's top it sits
const underInset = 1;
const underDrop = 9;

// Every module on the ship the pilot can switch, each type the once, in the
// order they sit in. A pair of scoops is one row worked by one key. Modules
// with no key of their own are left off the panel. A key packs its lowercase
// KeyboardEvent value first and uppercase HUD letter second.
const modulesOf = (ship) => {
  const list = [];

  ship.segments.forEach(({ module }) => {
    if (module.key && !list.includes(module.oneOf)) list.push(module.oneOf);
  });

  return list;
};

// Whether any part of a module is switched on
const isOn = (ship, module) => ship.segments.some((seg) => seg.module.oneOf === module && seg.active);

/**
 * @param {Object} game
 * @param {Object} ship - The ship whose modules are shown.
 */
export const renderControls = (game, ship) => {
  const { ctx, uiScale } = game;
  const modules = modulesOf(ship);
  const widest = Math.max(...modules.map(({ name }) => name.length)) * glyph;
  const boxX = game.uiWidth - inset - widest - gap - box;
  const textX = boxX + box + gap;
  const top = game.uiHeight - inset - (modules.length - 1) * rowGap - lineHeight;

  // The boxes and underlines, drawn in the HUD's own grid so they line up with
  // the text. Bevelled joins take the sharp points off the box corners
  ctx.save();
  ctx.scale(uiScale, uiScale);
  ctx.lineJoin = 'bevel';
  ctx.lineWidth = 1;

  modules.forEach((module, i) => {
    const y = top + i * rowGap;

    if (isOn(ship, module)) {
      ctx.fillStyle = colors.violet[2];
      ctx.fillRect(boxX, y, box, box);
    }

    ctx.strokeStyle = colors.violet[2];
    ctx.strokeRect(boxX, y, box, box);

    // A line under the one letter of the name that is the key to work it, a
    // touch narrower than the letter and dropped just below it
    const under = textX + module.name.indexOf(module.key[1]) * glyph;

    ctx.strokeStyle = colors.violet[2];
    ctx.beginPath();
    ctx.moveTo(under + underInset, y + underDrop);
    ctx.lineTo(under + glyph - underInset, y + underDrop);
    ctx.stroke();
  });

  ctx.restore();

  modules.forEach((module, i) => {
    renderText(game, module.name, textX, top + i * rowGap, textSize, colors.violet[2]);
  });
};
