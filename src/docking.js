// A craft shoves itself out of a bay at full power, then coasts the rest of the
// way clear on a fraction of it
const launchBurnDuration = 1;
const launchCoastDuration = 2;
const launchCoastPower = 0.25;

const thrusterOf = (craft) => craft.mounts.find(({ module }) => module?.thrust)?.module;

/**
 * A craft is docked while any of its pieces touches another craft's docking
 * segment. The ordinary collision pass supplies the contact.
 *
 * @param {Object[]} crafts
 * @param {Object[]} contacts
 */
export const dock = (crafts, contacts) => {
  crafts.forEach((craft) => (craft.dockedTo = 0));

  contacts.forEach(({ collider, other }) => {
    const home = collider.docks ? collider : other;
    const guest = (home === collider ? other : collider).owner;

    if (!home.docks || !guest?.mounts || guest.launching) return;

    guest.dockedTo = home.owner;
    guest.localMovementParent = home.owner;
  });
};

/**
 * Put a craft in the middle of its host and set it off out through the bay.
 *
 * @param {Object} craft
 */
export const launch = (craft) => {
  const host = craft.dockedTo;

  craft.dockedTo = 0;
  craft.localMovementParent = 0;
  craft.rotation = host.rotation;
  craft.x = host.x;
  craft.y = host.y;
  craft.dx = 0;
  craft.dy = 0;
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
