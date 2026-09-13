/** Place a craft inside a station as though it had entered through its bay. */
export const dockAt = (ship, station) => {
  Object.assign(ship, {
    dockedTo: station,
    rotation: station.rotation,
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
      // Ideally we'd remove an asteroid in a station, but not doing it saves 2B
      // ship.remove();
      return;
    }

    dockAt(ship, station);
    ship.docked?.(station);
  });
};

/**
 * Set a docked craft off out through the bay.
 *
 * @param {Object} craft
 */
export const launch = (craft) => {
  craft.dockedTo = 0;
  craft.launching = 3;
  craft.started = 1;
};

/**
 * Whether a craft is still seeing itself out of a bay, which it does under its
 * own steam whatever its pilot is asking of it.
 *
 * @param {Object} craft
 * @param {Number} dt - Seconds since the last update.
 * @returns {Boolean|undefined} launching
 */
export const flyOut = (craft, dt) => {
  if (!craft.launching) return;

  craft.launching = Math.max(0, craft.launching - dt);

  return 1;
};
