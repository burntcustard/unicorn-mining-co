import { player } from '../../src/client/player.ts';
import { init } from '../../src/client/core.ts';
import { game } from '../../src/client/game.ts';
import { ui } from '../../src/client/ui/dom/ui.ts';
import { syncDockedUi } from '../../src/client/ui/dom/docked-loader.ts';
import { setCraftActionDispatcher } from '../../src/client/network/craft-actions.ts';
import { Autogun } from '../../src/client/objects/modules/index.ts';

const { canvas, context } = init();

Object.assign(game, { canvas, ctx: context });
player.ship.dockedTo = 1;

setCraftActionDispatcher((action) => {
  if (action.action === 'sell') player.ship.applyDockAction(action, player);
});

export const dock = () => syncDockedUi({ ship: player.ship, available: true });
export const inspect = () => [
  player.credits,
  player.ship.cargoContents.length,
  player.ship.mounts[0].module instanceof Autogun,
  Boolean(player.ship.launchRequested),
];

export const damage = () => {
  player.ship.mounts[0].health = 1;
  ui.current.update();
};

export const refresh = () => ui.current?.update();
