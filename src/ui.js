import { cargoCount, playerShip, roomFor } from './player';
import { colors } from './colors';
import { renderControls } from './ui/controls';
import { renderDocked } from './ui/docked';
import { renderIndicators } from './ui/indicators';
import { renderText } from './text';

export const renderUI = (game, stations) => {
  renderIndicators(game, stations, colors.green[2], 10000);

  game.ctx.globalAlpha = playerShip.hudAlpha;

  renderControls(game, playerShip);

  game.ctx.globalAlpha = 1;

  if (playerShip.dockedTo && playerShip.started) renderDocked(game, playerShip);

  // Messages keep their own visibility and sit over the docked panel, so a
  // reward announced by a sale is still read
  if (playerShip.noteFor) {
    renderText(game, playerShip.note,
      game.uiWidth / 2, game.uiHeight - 40, 1, 0);
  }

  renderText(game, `$${playerShip.credits}`, 20, 20, 1);

  if (!roomFor(playerShip)) game.ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 300) / 2;
  renderText(game, `${cargoCount(playerShip)}/${playerShip.cargoSpace}`, game.uiWidth - 20, 20, 1, 1);
  game.ctx.globalAlpha = 1;

  renderText(game, `${`${Math.round(playerShip.x)}`.padStart(8)}/${`${Math.round(playerShip.y)}`.padEnd(8)}`,
    game.uiWidth / 2, 20, 1, 0);
};
