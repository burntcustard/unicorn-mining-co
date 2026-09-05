import { cargoScoop, floodlight, horn, instanceOf, shield, thrusterDualMd } from './modules';
import { Ship } from './ship';
import { colors } from './colors';
import { downKeys } from './keyboard';
import { flyOut } from './docking';

// What a pilot starts out with, which is not enough for anything good
const startingCredits = 500;

// How long a message stays up once it has been read, in seconds
const readingTime = 6;

export const playerShip = new Ship({
  shades: colors.white,
  x: 0,
  y: 0,
  credits: startingCredits,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
});

// Violet is the pink paint in the palette, and only it and white are available
// until the pilot has earned the rest.
const paints = {
  RED: colors.red,
  ORANGE: colors.orange,
  YELLOW: colors.yellow,
  GREEN: colors.green,
  BLUE: colors.cyan,
};
const unlockedPaints = [colors.violet, colors.white];
const visitedStations = new Set();

export const colorUnlocked = (shades) => unlockedPaints.includes(shades);

export const unlockColor = (color) => {
  const shades = paints[color];

  if (!colorUnlocked(shades)) {
    unlockedPaints.push(shades);
    say(`${color} UNLOCKED`);
  }
};

playerShip.destroyed = (module) => {
  unlockColor('RED');
  if (module.oneOf === horn) unlockColor('YELLOW');
};

playerShip.docked = (station) => {
  visitedStations.add(station);
  if (visitedStations.size > 2) unlockColor('GREEN');
};

// Keep acquisition order separate from where each module is fitted.
horn.shades = colors.yellow;
thrusterDualMd.shades = cargoScoop.shades = shield.shades = colors.violet;
playerShip.modules = [thrusterDualMd, cargoScoop, cargoScoop, horn, shield, floodlight].map(instanceOf);
playerShip.modules.forEach((module) => playerShip.fit(module));

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
