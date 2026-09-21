import { cargoCount, playerShip, roomFor } from './player';
import { colors } from './colors';
import { renderControls } from './ui/controls';
import { renderDocked } from './ui/docked-loader';
import { renderIndicators } from './ui/indicators';
import { type GameState } from './types';
import { type Vector } from './vector';
import { renderText } from './text';

export const renderUI = (
  game: GameState,
  stations: Array<{ position: Vector; radius: number }>,
) => {
  if (!game.uiAlpha) return;

  game.ctx.save();
  game.ctx.globalAlpha = game.uiAlpha;
  renderIndicators(game, stations, colors.green[2], 10000);

  game.ctx.globalAlpha = game.uiAlpha * playerShip.hudAlpha;

  renderControls(game, playerShip);

  game.ctx.globalAlpha = game.uiAlpha;

  if (playerShip.dockedTo && playerShip.started) renderDocked(game, playerShip);

  // Messages keep their own visibility and sit over the docked panel, so a
  // reward announced by a sale is still read
  if (playerShip.noteFor) {
    renderText({
      game,
      text: playerShip.note,
      x: game.uiWidth / 2,
      y: game.uiHeight - 40,
      size: 1,
      align: 0,
    });
  }

  renderText({ game, text: `$${playerShip.credits}`, x: 20, y: 20, size: 1 });

  if (!roomFor(playerShip)) {
    game.ctx.globalAlpha =
      game.uiAlpha * (0.5 + Math.sin(Date.now() / 300) / 2);
  }

  renderText({
    game,
    text: `${cargoCount(playerShip)}/${playerShip.cargoSpace}`,
    x: game.uiWidth - 20,
    y: 20,
    size: 1,
    align: 1,
  });
  game.ctx.globalAlpha = game.uiAlpha;

  renderText({
    game,
    text: `${`${Math.round(playerShip.position.x)}`.padStart(8)}/${`${Math.round(playerShip.position.y)}`.padEnd(8)}`,
    x: game.uiWidth / 2,
    y: 20,
    size: 1,
    align: 0,
  });
  game.ctx.restore();
};
