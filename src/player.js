import { cargoScoop, floodlight, horn, instanceOf, shield, thrusterDualMd, thrusters } from './modules';
import { Ship } from './ship';
import { colors } from './colors';
import { downKeys } from './keyboard';
import { flyOut } from './docking';
import { updateThrusterSound } from './sound';

export const playerShip = new Ship({
  shades: colors.white,
  x: 0,
  y: 0,
  credits: 500,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
  hudAlpha: 1,
});

// @ifdef DEBUG
playerShip.credits = 10000;
// @endif

// Violet is the pink paint in the palette, and only it and white are available
// until the pilot has earned the rest.
const unlockedPaints = [colors.violet, colors.white];
const visitedStations = new Set();

export const colorUnlocked = (shades) => unlockedPaints.includes(shades);

export const unlockColor = (color, reason) => {
  // Reward names follow the first five palettes in colors; strings survive
  // property mangling and also supply the exact name shown in the message.
  const shades = Object.values(colors)['RED ORANGE YELLOW GREEN CYAN'.split(' ').indexOf(color)];

  if (!colorUnlocked(shades)) {
    unlockedPaints.push(shades);
    say(`${reason} - ${color} UNLOCKED`);
    return true;
  }
};

playerShip.destroyed = () => {
  unlockColor('RED', 'DAMAGED');
};

playerShip.docked = (station) => {
  visitedStations.add(station);
  if (visitedStations.size > 2) unlockColor('GREEN', '3 STATION VISITS');
};

// Keep acquisition order separate from where each module is fitted.
horn.shades = colors.yellow;
thrusters.forEach((thruster) => thruster.shades = cargoScoop.shades = shield.shades = colors.violet);
playerShip.modules = [thrusterDualMd, cargoScoop, cargoScoop, horn, floodlight].map(instanceOf);
playerShip.modules.forEach((module) => playerShip.fit(module));

/**
 * @param {String} text - Upper case, and only what the font actually has.
 */
export const say = (text) => {
  playerShip.note = text;
  playerShip.noteFor = 10;
};

/**
 * Anything stowed fills exactly one of a cargo bay, so how full one is is
 * simply how much is in it.
 *
 * @param {Object} craft - Whichever craft is taking the cargo.
 * @returns {Number} count
 */
export const cargoCount = (craft) => craft.cargo.length + craft.cargoBay.length;

export const roomFor = (craft) => cargoCount(craft) < craft.cargoSpace;

export const stow = (craft, item) => craft.cargo.push(item);

/**
 * @param {Number} dt - Seconds since the last update.
 */
export const updatePlayer = (dt) => {
  playerShip.noteFor = Math.max(0, playerShip.noteFor - dt);
  playerShip.hudAlpha = Math.max(0, Math.min(1,
    playerShip.hudAlpha + (playerShip.dockedTo ? -2 : 2) * dt));

  if (playerShip.position.length() >= 5e4) unlockColor('YELLOW', 'EDGE REACHED');

  // A launching ship sees itself out of the bay
  const launching = flyOut(playerShip, dt);

  playerShip.fly(
    launching || (!playerShip.dockedTo && downKeys.Up) ? 1 : 0,
    launching || playerShip.dockedTo ? 0 : downKeys.ht - downKeys.ft,
  );
  // Normalize spin against the same steering limit used by Ship.update.
  // Steering effort also covers braking a spin and reversing turn direction.
  const turningSpeed = playerShip.spin * 16 /
    (playerShip.turnRate * playerShip.rotationalThrust * playerShip.launchThrottle ** 2 || 1);
  const steeringEffort = Math.min(1, Math.abs(playerShip.turn - turningSpeed));
  const engineLoad = Math.min(1, Math.max(
    playerShip.velocity.length() / playerShip.maxSpeed,
    Math.abs(turningSpeed),
    steeringEffort * 0.65,
  ));

  updateThrusterSound(!playerShip.dead && !playerShip.dockedTo && playerShip.engine.mount ?
      Math.max(steeringEffort * playerShip.launchThrottle,
        ...playerShip.segments.filter((segment) => segment.module === playerShip.engine)
          .map((segment) => segment.active)) :
    0, engineLoad);
};
