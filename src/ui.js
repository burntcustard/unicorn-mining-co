import { colors } from './colors';
import { playerShip } from './player';
import { renderControls } from './ui/controls';
import { renderDocked } from './ui/docked';
import { renderIndicators } from './ui/indicators';
import { renderText } from './text';

export const renderUI = (game, stations) => {
  renderIndicators(game, stations, colors.green[2], 10000);

  renderControls(game, playerShip);

  if (playerShip.dockedTo) renderDocked(game, playerShip);

  renderText(game, `$${playerShip.credits}`, 20, 20, 1);

  renderText(game, `${`${Math.round(playerShip.x)}`.padStart(8)}/${`${Math.round(playerShip.y)}`.padEnd(8)}`,
    game.uiWidth / 2, 20, 1, 0);

  if (playerShip.noteFor) {
    renderText(game, playerShip.note,
      game.uiWidth / 2, game.uiHeight - 40, 1, 0);
  }
};
