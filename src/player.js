import { Craft } from './craft';
import { colors } from './colors';
import { flyOut } from './docking';
import { keyDown } from './keyboard';
import { shipTypes } from './ships';

/**
 * Whoever is playing, as opposed to whichever craft they happen to be flying.
 * Credits and messages belong to the pilot; cargo belongs to a craft.
 */

// What a pilot starts out with, which is not enough for anything good
const startingCredits = 3500;

// How long a message stays up once it has been read, in seconds
const readingTime = 6;

export const player = {
  credits: startingCredits,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
};

export const playerShip = new Craft({
  craftData: shipTypes.mustang,
  shades: colors.white,
  x: 0,
  y: 0,
});

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
 * @param {Object} craft - Whichever craft is taking the cargo.
 * @returns {Boolean} room
 */
export const roomFor = (craft) => !craft.cargoSpace ||
  craft.cargo.length < craft.cargoSpace;

export const stow = (craft, item) => craft.cargo.push(item);

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updatePlayer = (dt) => {
  player.noteFor = Math.max(0, player.noteFor - dt);

  // An AI pilot will set its own ship's controls here. Whoever is aboard, a
  // launching ship sees itself out of the bay, and a ship on a road has the
  // road doing the driving for it
  const thrusting = !playerShip.localMovementParent?.drives &&
    (flyOut(playerShip, dt) || keyDown('ArrowUp'));

  playerShip.fly(
    thrusting ? 1 : 0,
    (keyDown('ArrowRight') ? 1 : 0) - (keyDown('ArrowLeft') ? 1 : 0),
  );
};
