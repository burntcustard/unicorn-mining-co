import { Craft } from './craft';
import { colors } from './colors';
import { downKeys } from './keyboard';
import { flyOut } from './docking';
import { shipTypes } from './ships';

// What a pilot starts out with, which is not enough for anything good
const startingCredits = 3500;

// How long a message stays up once it has been read, in seconds
const readingTime = 6;

export const playerShip = new Craft({
  craftData: shipTypes.mustang,
  shades: colors.white,
  x: 0,
  y: 0,
  credits: startingCredits,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
});

/**
 * @param {String} text - Upper case, and only what the font actually has.
 */
export const say = (text) => {
  playerShip.note = text;
  playerShip.noteFor = readingTime;
};

/**
 * Anything stowed fills exactly one of a cargo bay, so how full one is is
 * simply how much is in it.
 *
 * @param {Object} craft - Whichever craft is taking the cargo.
 * @returns {Boolean} room
 */
export const roomFor = (craft) =>
  craft.cargo.length + craft.cargoBay.length < craft.cargoSpace;

export const stow = (craft, item) => craft.cargo.push(item);

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updatePlayer = (dt) => {
  playerShip.noteFor = Math.max(0, playerShip.noteFor - dt);

  // A launching ship sees itself out of the bay
  playerShip.fly(
    flyOut(playerShip, dt) || downKeys.Up ? 1 : 0,
    downKeys.ht - downKeys.ft,
  );
};
