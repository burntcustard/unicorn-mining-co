import { camera, renderDeadzone } from './camera';
import { glows, lights, toggleGlows, toggleLights } from './lighting';
import { Craft } from './craft';
import { bindKeys } from './keyboard';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { playerShip } from './player';
import { renderFps } from './fps';
import { renderText } from './text';
import { shipTypes } from './ships';
import { sky } from './background';
import { textDemo } from './text-demo';

export let showDeadzone = false;
let showMass = false;
let showTextDemo = false;
let showColorsDemo = false;

export { lights };

// One hull of every colour, lined up to see how the light falls across them
export const debugCrafts = (game) => [
  colors.black,
  colors.red,
  colors.orange,
  colors.yellow,
  colors.green,
  colors.cyan,
  colors.violet,
  colors.black,
  colors.white,
].map((shades, i) => new Craft({
  craftData: shipTypes.mustang,
  shades,
  x: 120 + i * 120,
  y: game.height - 100,
}));

export const bindDebug = (game) => {
  bindKeys('2', () => showColorsDemo = !showColorsDemo);
  bindKeys('3', () => showTextDemo = !showTextDemo);
  bindKeys('4', () => showDeadzone = !showDeadzone);
  bindKeys('5', () => showMass = !showMass);
  bindKeys('6', sky.cycle);
  bindKeys('7', toggleLights);
  bindKeys('8', toggleGlows);
  bindKeys('9', () => game.physicsOn = !game.physicsOn);
};

export const renderDebug = (game, sprites, nearbyRadius) => {
  if (showDeadzone) {
    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);
    game.ctx.beginPath();
    game.ctx.arc(playerShip.x, playerShip.y, nearbyRadius, 0, Math.PI * 2);
    game.ctx.strokeStyle = colors.red[2];
    game.ctx.stroke();
    game.ctx.restore();
    renderDeadzone(game);
  }

  renderFps(game);
  renderText({ game, text: `2 COLORS-DEMO:${showColorsDemo ? 'ON' : 'OFF'}`, x: 10, y: 90 });
  renderText({ game, text: `3 TEXT-DEMO:${showTextDemo ? 'ON' : 'OFF'}`, x: 10, y: 110 });
  renderText({ game, text: `4 DEADZONE:${showDeadzone ? 'ON' : 'OFF'}`, x: 10, y: 130 });
  renderText({ game, text: `5 MASS-VALUES:${showMass ? 'ON' : 'OFF'}`, x: 10, y: 150 });
  renderText({ game, text: `6 SKY:${sky.label}`, x: 10, y: 170 });
  renderText({ game, text: `7 LIGHTING:${lights ? 'ON' : 'OFF'}`, x: 10, y: 190 });
  renderText({ game, text: `8 GLOWS:${glows ? 'ON' : 'OFF'}`, x: 10, y: 210 });
  renderText({ game, text: `9 PHYSICS:${game.physicsOn ? 'ON' : 'OFF'}`, x: 10, y: 230 });

  if (showMass) {
    game.ctx.save();
    game.ctx.fillStyle = colors.white[2];
    game.ctx.font = '12px monospace';
    game.ctx.textAlign = 'center';
    game.ctx.textBaseline = 'middle';
    sprites.forEach(({ mass, x, y }) => {
      if (mass) game.ctx.fillText(Math.round(mass), x, y);
    });
    game.ctx.restore();
  }
};

export const renderDebugDemos = (game) => {
  if (showColorsDemo) colorsDemo(game);
  if (showTextDemo) textDemo(game);
};
