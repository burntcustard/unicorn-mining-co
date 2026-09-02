// A craft shoves itself out of a bay at full power, then coasts the rest of the
// way clear on a fraction of it
const launchBurnDuration = 1;
const launchCoastDuration = 2;
const launchCoastPower = 0.25;

const thrusterOf = (craft) => craft.mounts.find(({ module }) => module?.forwardThrust)?.module;

/** Place a craft inside a station as though it had entered through its bay. */
export const dockAt = (ship, station) => {
  ship.segments.forEach((segment) => (segment.active = false));
  ship.velocity.set(station.velocity);
  Object.assign(ship, {
    dockedTo: station,
    rotation: station.rotation,
    spin: 0,
    x: station.x,
    y: station.y,
  });
};

/**
 * A craft docks the moment any of its pieces touches another craft's docking
 * segment. Docking is a one-way latch from there: once set, a ship keeps its
 * hitboxes empty and its own physics frozen (see Craft#hitboxes and
 * Craft#update), and only `launch` clears it. Being carried along by the
 * parent from then on is `localMovement`'s job, same as anything else caught
 * up in a mover.
 *
 * @param {Object[]} contacts - All contacts from the collision pass.
 */
export const dock = (contacts) => {
  contacts.forEach(({ collider, other }) => {
    // Either side of a contact can be the bay, depending on which was built first
    const home = collider.dockSegment ? collider : other;
    const ship = (home === collider ? other : collider).owner;
    const station = home.owner;

    // Only a docking segment can latch a ship, and only when it is not on its way out.
    if (!home.dockSegment || !ship || ship.launching) return;

    // Rocks can be shoved into a bay, but only crafts can use one: swallow the
    // asteroid instead of treating its collision body as a docking ship.
    if (ship.sections) {
      ship.remove();
      return;
    }

    dockAt(ship, station);
  });
};

/**
 * Set a docked craft off out through the bay.
 *
 * @param {Object} craft
 */
export const launch = (craft) => {
  craft.dockedTo = 0;
  craft.launching = launchBurnDuration + launchCoastDuration;
};

/**
 * Whether a craft is still seeing itself out of a bay, which it does under its
 * own steam whatever its pilot is asking of it.
 *
 * @param {Object} craft
 * @param {Number} dt - Seconds since the last update.
 * @returns {Boolean} launching
 */
export const flyOut = (craft, dt) => {
  if (!craft.launching) return false;

  craft.launching = Math.max(0, craft.launching - dt);

  // Full power while it shoves itself out, then a fraction of it to coast
  // clear on, then back to whatever the pilot is asking for
  const coasting = craft.launching && craft.launching <= launchCoastDuration;

  craft.supply(thrusterOf(craft), coasting ? launchCoastPower : 1);

  return true;
};
