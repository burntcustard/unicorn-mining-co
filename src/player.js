/**
 * Whoever is playing, as opposed to whichever hull they happen to be flying.
 * Credits and cargo outlive a ship: they survive selling one and buying the
 * next, so they are kept apart from it.
 */

// What a pilot starts out with, which is not enough for anything good
const startingCredits = 500;

// How long a message stays up once it has been read, in seconds
const readingTime = 6;

export const player = {
  credits: startingCredits,
  // Everything scooped up and not yet sold on
  hold: [],
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
};

/**
 * @param {String} text - Upper case, and only what the font actually has.
 */
export const say = (text) => {
  player.note = text;
  player.noteFor = readingTime;
};

export const earn = (amount) => {
  player.credits += amount;
};

/**
 * @returns {Boolean} paid - Whether there was enough to cover it.
 */
export const spend = (amount) => {
  if (player.credits < amount) return false;

  player.credits -= amount;

  return true;
};

/**
 * Anything stowed fills exactly one of a hold, so how full one is is simply
 * how much is in it.
 *
 * @param {Object} ship - Whichever hull is being flown, which is what says how
 *   much room there is.
 * @returns {Boolean} room
 */
export const roomFor = (ship) => player.hold.length < ship.cargo;

export const stow = (item) => player.hold.push(item);

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updatePlayer = (dt) => {
  player.noteFor = Math.max(0, player.noteFor - dt);
};
