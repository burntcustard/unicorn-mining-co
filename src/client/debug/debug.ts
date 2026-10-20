import { camera, renderDeadzone } from '../camera';
import { lights, toggleLights } from '../utilities/lighting';
import { playSound, testTone } from '../audio/sound-loader';
import { bindKeys } from '../input/input';
import { colors } from '../../specs/colors';
import { colorsDemo } from './colors-demo';
import { renderText } from '../ui/text';
import { sky } from '../background/background';
import { textDemo } from './text-demo';
import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { Ship } from '../objects/ship';
import { type Pose } from '../types';

export let showDeadzone = false;
let showMass = false;
let showNpcState = false;
let showTextDemo = false;
let showColorsDemo = false;

// Future light candidates:
// motor: [0.08, 0, 55, 0.04, 0.2, 0.6, 0, 1, 0, undefined, 0]
// beam: [0.08, 0, 260, 0.02, 0.1, 0.35, 1, 1, 2, undefined, 0]
// discharge: [0.08, 0, 900, 0.01, 0.03, 0.5, 0, 1, -0.8, undefined, 0]
// whoosh: [0.1, 0, 0, 0.06, 0.12, 0.5, 4, 0.5, 700]

export { lights };

// One hull of every color, lined up to see how the light falls across them
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
  ].map((shades, i) =>
    new Ship({
      shades,
      position: Vec.create(120 + i * 120, game.height - 100),
    }).addToScene(),
  );

export const bindDebug = (game: GameState) => {
  bindKeys('2', () => (showColorsDemo = !showColorsDemo));
  bindKeys('3', () => (showTextDemo = !showTextDemo));
  bindKeys('4', () => (showDeadzone = !showDeadzone));
  bindKeys('5', () => (showMass = !showMass));

  bindKeys('6', (sky as typeof sky & { cycle: () => void }).cycle);

  bindKeys('7', toggleLights);
  bindKeys('8', () => (showNpcState = !showNpcState));
  bindKeys('9', () => (game.physicsOn = !game.physicsOn));
  bindKeys('0', testTone);
  bindKeys('c', () => playSound(9));
  bindKeys('p', () => playSound(2));
  bindKeys('m', () => playSound(6));
  bindKeys('n', () => playSound(7));
};

export const renderDebug = ({
  game,
  sprites,
  ship,
  poses,
}: {
  game: GameState;
  sprites: GameObject[];
  ship: Ship;
  poses?: Map<number, Pose>;
}) => {
  if (showDeadzone) {
    const drillTipCollider = ship
      .hitbox()
      .find((collider) => ship.isDrillTip(collider));

    if (drillTipCollider) {
      game.ctx.save();
      game.ctx.scale(game.scale, game.scale);
      game.ctx.translate(-camera.x, -camera.y);
      game.ctx.beginPath();
      game.ctx.arc(
        drillTipCollider.position.x,
        drillTipCollider.position.y,
        drillTipCollider.radius,
        0,
        Math.PI * 2,
      );
      game.ctx.strokeStyle = colors.red[2];
      game.ctx.stroke();
      game.ctx.restore();
    }

    renderDeadzone(game);
  }

  [
    `2 COLORS-DEMO:${showColorsDemo ? 'ON' : 'OFF'}`,
    `3 TEXT-DEMO:${showTextDemo ? 'ON' : 'OFF'}`,
    `4 ZONE-BORDERS:${showDeadzone ? 'ON' : 'OFF'}`,
    `5 MASS-VALUES:${showMass ? 'ON' : 'OFF'}`,
    `6 SKY:${sky.label}`,
    `7 LIGHTING:${lights ? 'ON' : 'OFF'}`,
    `8 NPC STATE:${showNpcState ? 'ON' : 'OFF'}`,
    `9 PHYSICS:${game.physicsOn ? 'ON' : 'OFF'}`,
  ].forEach((text, index) => {
    renderText({ game, text, x: 20, y: 170 + index * 20 });
  });

  if (showNpcState) {
    const ratio = game.scale / game.uiScale;

    sprites.forEach((object) => {
      if (!(object instanceof Ship) || !object.npcState || object.dead) return;
      const { position } = poses?.get(object.id) || object;

      renderText({
        game,
        text: `${object.name} ${object.npcState}`,
        x: (position.x - camera.x) * ratio,
        y: (position.y - camera.y - object.radius) * ratio - 14,
        align: 0,
      });
    });
  }

  if (showMass) {
    game.ctx.save();
    game.ctx.scale(game.scale, game.scale);
    game.ctx.translate(-camera.x, -camera.y);
    game.ctx.fillStyle = colors.white[2];
    game.ctx.font = '14px monospace';
    game.ctx.textAlign = 'center';
    game.ctx.textBaseline = 'middle';

    sprites.forEach(({ mass, position }) => {
      if (mass) {
        game.ctx.fillText(`${Math.round(mass)}`, position.x, position.y);
      }
    });

    game.ctx.restore();
  }
};

export const renderDebugDemos = (game: GameState) => {
  if (showColorsDemo) colorsDemo(game);

  if (showTextDemo) textDemo(game);
};

import { type GameState } from '../game';
