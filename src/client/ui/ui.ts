import { player } from '../player';
import { colors } from '../../specs/colors';
import { renderIndicators } from './indicators';
import * as Vec from '../utilities/vector';
import { renderText } from './text';
import { renderFps } from './fps';

export const renderUI = (
  game: GameState,
  stations: Array<{ position: Vec.Value; radius: number }>,
  {
    shipDestroyed,
    shipStranded,
  }: { shipDestroyed: boolean; shipStranded: boolean },
) => {
  if (!shipDestroyed && !shipStranded && !game.uiAlpha) return;

  game.ctx.save();
  game.ctx.globalAlpha = shipDestroyed || shipStranded ? 1 : game.uiAlpha;

  if (shipDestroyed || shipStranded) {
    const message = shipDestroyed
      ? 'YOU DIED - PRESS ANY KEY TO RESPAWN'
      : player.ship.fuel <= 0
        ? 'OUT OF FUEL - PRESS R TO RESPAWN'
        : 'NO THRUSTER - PRESS R TO RESPAWN';

    renderText({
      game,
      text: message,
      x: game.uiWidth / 2,
      y: game.uiHeight / 2 + (shipDestroyed ? 0 : 40),
      size: Math.min(1, (game.uiWidth - 24) / (message.length * 13)),
      align: 0,
    });

    if (shipDestroyed || !game.uiAlpha) {
      game.ctx.restore();
      return;
    }
  }

  game.ctx.globalAlpha = game.uiAlpha;
  renderIndicators(game, stations, colors.green[2], 10000);

  renderFps({ game, x: game.uiWidth / 2 - 40, y: game.uiHeight - 65 });

  game.ctx.restore();
};

import { type GameState } from '../game';
