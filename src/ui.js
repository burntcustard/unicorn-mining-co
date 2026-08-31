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

  renderText({
    game,
    text: `${Math.round(playerShip.x)}/${Math.round(playerShip.y)}`,
    x: 20,
    y: 20,
  });

  renderText({ game, text: `$${player.credits}`, x: 10, y: 50 });

  if (player.noteFor) {
    renderText({
      alignCenter: true,
      game,
      text: player.note,
      x: game.uiWidth / 2,
      y: game.uiHeight - 40,
    });
  }
};
