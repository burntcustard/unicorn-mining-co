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

// Production builds rewrite these tags everywhere except `ui/dom` sources,
// so DOM code must request them through here rather than writing the literals.
export const refuelShip = (ship: Ship) =>
  applyCraftAction(ship, { action: 'refuel' });

export const buyAmmo = (ship: Ship) =>
  applyCraftAction(ship, { action: 'buyAmmo' });

export const repairHullSegment = ({
  ship,
  hullIndex,
}: {
  ship: Ship;
  hullIndex: number;
}) => applyCraftAction(ship, { action: 'repairHull', hullIndex });

export const removeModule = ({ ship, mount }: { ship: Ship; mount: number }) =>
  applyCraftAction(ship, { action: 'remove', mount });
