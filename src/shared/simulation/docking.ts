import { type Ship } from '../craft/ship';

/**
 * Begin the shared automatic launch; Ship.update advances its timer.
 */
export const launch = (ship: Ship) => {
  ship.dockedTo = undefined;
  ship.launching = 3;
};
