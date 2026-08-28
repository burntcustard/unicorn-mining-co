// A craft shoves itself out of a bay at full power, then coasts the rest of the
// way clear on a fraction of it
const launchBurnDuration = 1;
const launchCoastDuration = 2;
const launchCoastPower = 0.25;

const thrusterOf = (craft) => craft.mounts.find(({ module }) => module?.forwardThrust)?.module;

/**
 * A craft docks the moment any of its pieces touches another craft's docking
 * segment. Docking is a one-way latch from there: once set, a collider.owner keeps its
 * hitboxes empty and its own physics frozen (see Craft#hitboxes and
 * Craft#update), and only `launch` clears it. Being carried along by the
 * parent from then on is `localMovement`'s job, same as anything else caught
 * up in a mover.
 *
 * @param {Object[]} contacts - Already filtered down to ones touching a dockSegment.
 */
export const dock = (contacts) => {
  contacts.forEach(({ collider, other: home }) => {
    // If the ship is already docked or is launching, don't re-dock
    if (collider.owner.dockedTo || collider.owner.launching) return;

    collider.owner.segments.forEach((segment) => (segment.active = false));
    collider.owner.rotation = home.owner.rotation;
    collider.owner.x = home.owner.x;
    collider.owner.y = home.owner.y;
    collider.owner.velocity.x = 0;
    collider.owner.velocity.y = 0;
    collider.owner.spin = 0;
    collider.owner.dockedTo = home.owner;
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
