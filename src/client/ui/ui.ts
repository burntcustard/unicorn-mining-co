import { player } from '../player';
import { colors } from '../../specs/colors';
import { renderControls } from './controls';
import { renderDocked } from './docked-loader';
import { renderIndicators } from './indicators';
import * as Vec from '../utilities/vector';
import { type Ship } from '../objects/ship';
import { renderText } from './text/text';

export const renderUI = (
  game: GameState,
  stations: Array<{ position: Vec.Value; radius: number }>,
  {
    controlsShip,
    shipDestroyed,
  }: { controlsShip: Ship; shipDestroyed: boolean },
) => {
  if (!game.uiAlpha) return;

  game.ctx.save();
  game.ctx.globalAlpha = game.uiAlpha;

  if (shipDestroyed) {
    const message = 'YOU DIED - PRESS ANY KEY TO RESPAWN';

    renderText({
      game,
      text: message,
      x: game.uiWidth / 2,
      y: game.uiHeight / 2,
      size: Math.min(1, (game.uiWidth - 24) / (message.length * 13)),
      align: 0,
    });

    game.ctx.restore();
    return;
  }

  renderIndicators(game, stations, colors.green[2], 10000);

  game.ctx.globalAlpha = game.uiAlpha * player.hudAlpha;

  renderControls(game, controlsShip);

  game.ctx.globalAlpha = game.uiAlpha;

  if (player.ship.dockedTo && player.started) renderDocked(game, player.ship);

  // Messages keep their own visibility and sit over the docked panel, so a
  // reward announced by a sale is still read
  if (player.noteFor) {
    renderText({
      game,
      text: player.note,
      x: game.uiWidth / 2,
      y: game.uiHeight - 40,
      size: 1,
      align: 0,
    });
  }

  renderText({ game, text: `$${player.credits}`, x: 20, y: 20, size: 1 });

  if (player.ship.cargoContents.length >= player.ship.cargoSpace) {
    game.ctx.globalAlpha =
      game.uiAlpha * (0.5 + Math.sin(Date.now() / 300) / 2);
  }

  renderText({
    game,
    text: `${player.ship.cargoContents.length}/${player.ship.cargoSpace}`,
    x: game.uiWidth - 20,
    y: 20,
    size: 1,
    align: 1,
  });

  game.ctx.globalAlpha = game.uiAlpha;

  renderText({
    game,
    text: `${`${Math.round(player.ship.position.x)}`.padStart(8)}/${`${Math.round(player.ship.position.y)}`.padEnd(8)}`,
    x: game.uiWidth / 2,
    y: 20,
    size: 1,
    align: 0,
  });

  game.ctx.restore();
};

import { type GameState } from '../game';
