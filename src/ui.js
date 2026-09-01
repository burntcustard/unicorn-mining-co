import { player, playerShip } from './player';
import { colors } from './colors';
import { renderControls } from './ui/controls';
import { renderDocked } from './ui/docked';
import { renderIndicators } from './ui/indicators';
import { renderText } from './text';

export const renderUI = (game, stations) => {
  renderIndicators(game, stations, colors.green[2], 10000);

  renderControls(game, playerShip);

  if (playerShip.dockedTo) renderDocked(game, playerShip);

  renderText(game, `${Math.round(playerShip.x)}/${Math.round(playerShip.y)}`, 20, 20);

  renderText(game, `$${player.credits}`, 10, 50);

  if (player.noteFor) {
    renderText(game, player.note, game.uiWidth / 2, game.uiHeight - 40, 1, '#fff', 1);
  }
};
