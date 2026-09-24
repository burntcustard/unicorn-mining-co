import { colors } from '../../shared/colors';
import { outline } from '../outline';
import { renderText } from '../text';
import { type Module } from '../../shared/modules/module';
import { type Segment } from '../../shared/types';
import { type Ship } from '../../shared/craft/ship';
import { moduleControls } from '../../shared/craft/control-ship';
import { defaultKeybindings } from '../keybindings';

/**
 * The bottom-right readout of the ship's modules, after the fashion of an Elite
 * cockpit panel: every module the ship carries, listed by name, with a box
 * beside each one the pilot can switch that fills in blue while it runs. The
 * key that works a module is underlined in its name. It only shows state and is
 * never read from: the keyboard still does the toggling.
 */

// How big the panel text is against the demo text, and the width of one glyph
// and the height of one line at that size
const textSize = 0.6;
const glyph = 13 * textSize;
const lineHeight = 15 * textSize;

// How far the panel sits in from the corner, how far one row drops below the
// last, the size of a module's swatch and the gap from it to the name beside it
const inset = 20;
const rowGap = 16;
const box = 8;
const gap = 6;

// How far in from each side of a letter its key-underline is drawn, and how far
// below the row's top it sits
const underDrop = 10;

// Every module on the ship the pilot can switch, each type the once, in the
// order their mounts sit in. A pair of cargo hatches is one row worked by one key. Modules
// worked through the separate flight controls are left off the panel. The
// underline follows the configured key instead of the module name.
/**
 * ship: The ship whose modules are shown.
 */
export const renderControls = (game: GameState, ship: Ship) => {
  const { ctx, uiScale } = game;
  const modules: (typeof Module)[] = [];

  ship.mounts.forEach(
    ({ module }: { module?: Module | 0 }) =>
      module &&
      !module.forwardThrust &&
      !modules.includes(module.constructor as typeof Module) &&
      modules.push(module.constructor as typeof Module),
  );
  const widest = Math.max(...modules.map(({ label }) => label.length)) * glyph;
  const boxX = game.uiWidth - inset - widest - gap - box;
  const textX = boxX + box + gap;
  const top =
    game.uiHeight - inset - (modules.length - 1) * rowGap - lineHeight;

  // The boxes and underlines, drawn in the HUD's own grid so they line up with
  // the text. Bevelled joins take the sharp points off the box corners
  ctx.save();
  ctx.scale(uiScale, uiScale);
  ctx.lineJoin = 'bevel';
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.violet[2];

  modules.forEach((module, i) => {
    const y = top + i * rowGap;

    if (
      ship.segments.some(
        (seg: Segment) => seg.module.constructor === module && seg.active,
      )
    ) {
      ctx.fillStyle = colors.violet[2];
      ctx.fillRect(boxX, y, box, box);
    }

    const path = new Path2D();

    path.rect(boxX, y, box, box);
    // Underline the first bound key that occurs in this module's label.
    const action = moduleControls.find(({ Type }) => Type === module)?.input;
    const key = action && defaultKeybindings[action].keys[0]?.toLowerCase();
    const keyIndex = key ? module.label.toLowerCase().indexOf(key) : -1;

    if (keyIndex >= 0) {
      path.moveTo(textX + keyIndex * glyph, y + underDrop);
      path.lineTo(textX + (keyIndex + 1) * glyph - 1, y + underDrop);
    }
    outline({ ctx, path, radius: textSize });
    ctx.stroke(path);
  });

  ctx.restore();

  modules.forEach((module, i) => {
    renderText({
      game,
      text: module.label,
      x: textX,
      y: top + i * rowGap,
      size: textSize,
      align: -1,
      color: colors.violet[2],
    });
  });
};

import { type GameState } from '../game';
