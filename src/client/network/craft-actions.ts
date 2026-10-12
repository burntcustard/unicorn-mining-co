import { type CraftAction } from '../protocol/network';
import { type Ship } from '../objects/ship';
import { player } from '../player';

type DockActionDispatcher = (
  ship: Ship,
  action: Parameters<Ship['applyDockAction']>[0],
) => CraftAction | undefined;

let dispatch: DockActionDispatcher = (ship, action) =>
  ship.applyDockAction(action, player);

export const setCraftActionDispatcher = (next: DockActionDispatcher) => {
  dispatch = next;
};

export const applyCraftAction: DockActionDispatcher = (ship, action) =>
  dispatch(ship, action);
