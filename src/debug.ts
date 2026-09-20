import { camera, renderDeadzone } from './camera';
import { glows, lights, toggleGlows, toggleLights } from './lighting';
import { playSound, testTone } from './sound-loader';
import { Ship } from './ship';
import { bindKeys } from './keyboard';
import { colors } from './colors';
import { colorsDemo } from './colors-demo';
import { playerShip } from './player';
import { renderFps } from './fps';
import { renderText } from './text';
import { sky } from './background';
import { textDemo } from './text-demo';
import { Vector } from './vector';
import { type Collider, type GameState, type WorldObject } from './types';

export let showDeadzone = false;
let showMass = false;
let showTextDemo = false;
let showColorsDemo = false;

// Future light candidates:
// motor: [0.08, 0, 55, 0.04, 0.2, 0.6, 0, 1, 0, undefined, 0]
// beam: [0.08, 0, 260, 0.02, 0.1, 0.35, 1, 1, 2, undefined, 0]
// discharge: [0.08, 0, 900, 0.01, 0.03, 0.5, 0, 1, -0.8, undefined, 0]
// whoosh: [0.1, 0, 0, 0.06, 0.12, 0.5, 4, 0.5, 700]

export { lights };

// One hull of every colour, lined up to see how the light falls across them
export const debugCrafts = (game: GameState) =>
  [
    ['#000', '#111', '#222', '#879', '#200'],
    colors.red,
    colors.orange,
    colors.yellow,
    colors.green,
    colors.cyan,
    colors.violet,
    ['#000', '#111', '#222', '#879', '#200'],
    colors.white,
  ].map(
    (shades, i) =>
      new Ship({
        shades,
        position: Vector(120 + i * 120, game.height - 100),
      }),
  );

export const bindDebug = (game: GameState) => {
  bindKeys('2', () => (showColorsDemo = !showColorsDemo));
  bindKeys('3', () => (showTextDemo = !showTextDemo));
  bindKeys('4', () => (showDeadzone = !showDeadzone));
  bindKeys('5', () => (showMass = !showMass));
  bindKeys('6', (sky as typeof sky & { cycle: () => void }).cycle);
  bindKeys('7', toggleLights);
  bindKeys('8', toggleGlows);
  bindKeys('9', () => (game.physicsOn = !game.physicsOn));
  bindKeys('0', testTone);
  bindKeys('c', () => playSound(9));
  bindKeys('p', () => playSound(2));
  bindKeys('m', () => playSound(6));
  bindKeys('n', () => playSound(7));
};

export const renderDebug = (
  game: GameState,
  sprites: WorldObject[],
  nearbyRadius: number,
) => {
  if (showDeadzone) {
    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);
    game.ctx.beginPath();
    game.ctx.arc(
      playerShip.position.x,
      playerShip.position.y,
      nearbyRadius,
      0,
      Math.PI * 2,
    );
    const drill = playerShip
      .hitboxes()
      .find(
        ({ outline, segment }: Collider) => !outline && segment?.module.grinds,
      );

    if (drill) {
      game.ctx.arc(
        drill.position.x,
        drill.position.y,
        drill.radius,
        0,
        Math.PI * 2,
      );
    }

    game.ctx.strokeStyle = colors.red[2];
    game.ctx.stroke();
    game.ctx.restore();
    renderDeadzone(game);
  }

  renderFps(game);
  renderText({
    game,
    text: `2 COLORS-DEMO:${showColorsDemo ? 'ON' : 'OFF'}`,
    x: 20,
    y: 90,
  });
  renderText({
    game,
    text: `3 TEXT-DEMO:${showTextDemo ? 'ON' : 'OFF'}`,
    x: 20,
    y: 110,
  });
  renderText({
    game,
    text: `4 ZONE-BORDERS:${showDeadzone ? 'ON' : 'OFF'}`,
    x: 20,
    y: 130,
  });
  renderText({
    game,
    text: `5 MASS-VALUES:${showMass ? 'ON' : 'OFF'}`,
    x: 20,
    y: 150,
  });
  renderText({ game, text: `6 SKY:${sky.label}`, x: 20, y: 170 });
  renderText({
    game,
    text: `7 LIGHTING:${lights ? 'ON' : 'OFF'}`,
    x: 20,
    y: 190,
  });
  renderText({ game, text: `8 GLOWS:${glows ? 'ON' : 'OFF'}`, x: 20, y: 210 });
  renderText({
    game,
    text: `9 PHYSICS:${game.physicsOn ? 'ON' : 'OFF'}`,
    x: 20,
    y: 230,
  });

  if (showMass) {
    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);
    game.ctx.fillStyle = colors.white[2];
    game.ctx.font = '12px monospace';
    game.ctx.textAlign = 'center';
    game.ctx.textBaseline = 'middle';
    sprites.forEach(({ mass, position }) => {
      if (mass)
        game.ctx.fillText(`${Math.round(mass)}`, position.x, position.y);
    });
    game.ctx.restore();
  }
};

export const renderDebugDemos = (game: GameState) => {
  if (showColorsDemo) colorsDemo(game);
  if (showTextDemo) textDemo(game);
};
