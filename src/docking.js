import { collisions } from './collisions';
import { dockingBay } from './modules';

// A ship shoves itself out of a bay at full power, then coasts the rest of the
// way clear on a fraction of it
const launchBurnDuration = 1;
const launchCoastDuration = 2;
const launchCoastPower = 0.25;

const thrusterOf = (ship) => ship.mounts.find(({ module }) => module?.thrust)?.module;

/**
 * A ship counts as docked once it has flown all the way through a bay and come
 * to rest inside the station, clear of the bay itself. Only the pieces a ship
 * can pass through are looked at, so bumping along the outside never counts.
 *
 * @param {Object} ship
 */
export const checkDocking = (ship) => {
  const inside = ship.hitboxes()
    // A throat sits inside the ship noticing cargo, and is not the ship itself
    .filter(({ segment }) => !segment.catches)
    .flatMap(collisions)
    .filter(({ other }) => other.open)
    .map(({ other }) => other);
  const home = inside.find(({ segment }) => segment.module !== dockingBay);

  ship.dockedTo = home && !inside.some(({ segment }) => segment.module === dockingBay) ?
    home.owner :
    null;

  // Anything sat inside a station gets carried around by it
  if (ship.dockedTo) ship.localMovement = ship.dockedTo;
};

/**
 * Put a ship in the middle of its station and set it off out through the bay.
 * A bay faces the way its station does, so a ship lined up with the station is
 * pointing straight down the way out.
 *
 * @param {Object} ship
 */
export const launch = (ship) => {
  const station = ship.dockedTo;

  ship.rotation = station.rotation;
  ship.x = station.x;
  ship.y = station.y;
  ship.dx = 0;
  ship.dy = 0;
  ship.launching = launchBurnDuration + launchCoastDuration;
};

/**
 * Whether a ship is still seeing itself out of a bay, which it does under its
 * own steam whatever its pilot is asking of it.
 *
 * @param {Object} ship
 * @param {Number} dt - Seconds since the last update.
 * @returns {Boolean} launching
 */
export const flyOut = (ship, dt) => {
  if (!ship.launching) return false;

  ship.launching = Math.max(0, ship.launching - dt);

  // Full power while it shoves itself out, then a fraction of it to coast
  // clear on, then back to whatever the pilot is asking for
  const coasting = ship.launching && ship.launching <= launchCoastDuration;

  ship.supply(thrusterOf(ship), coasting ? launchCoastPower : 1);

  return true;
};
