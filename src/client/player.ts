import * as Vec from './utilities/vector';
import { Ship } from './objects/ship';
import { moduleTypesById } from './objects/modules/index';
import { startingCredits } from '../specs/player';
import { mustang } from '../specs/ships';
import { game } from './game';
import { colors, paintColors } from '../specs/colors';
import { type Shades } from './types';

export const player = {
  credits: startingCredits,
  ships: [
    new Ship({
      shades: colors.white,
      position: Vec.create(),
      networked: 1,
    }),
  ],
  // The first owned ship is the one the player is currently piloting.
  get ship() {
    return this.ships[0];
  },
  // Violet is the pink paint in the paint selection.
  unlockedPaints: [colors.violet, colors.white, colors.yellow] as Shades[],
  visitedStations: new Set<number>(),
  queuedNotes: [] as string[],
  // The last thing worth telling the pilot about, and how long it stays visible.
  note: '',
  noteFor: 0,
  hudAlpha: 0,
  started: false,
};

/**
 * Restore the server's paint choices after joining or receiving progress.
 */
export const syncPaintUnlocks = (
  mask: number | undefined,
  paints = player.unlockedPaints,
) => {
  if (mask === undefined) return;
  paints.splice(
    0,
    paints.length,
    ...paintColors.filter((_, i) => mask & (1 << i)),
  );
};

const paintUnlocks = new Map<string, Shades>([
  ['RED', colors.red],
  ['ORANGE', colors.orange],
  ['YELLOW', colors.yellow],
  ['GREEN', colors.green],
  ['CYAN', colors.cyan],
]);

export const paintUnlocked = (shades: Shades) =>
  player.unlockedPaints.includes(shades);

export const unlockPaint = (color: string, reason: string) => {
  const shades = paintUnlocks.get(color);

  if (shades && !paintUnlocked(shades)) {
    player.unlockedPaints.push(shades);
    say(`${reason} - ${color} UNLOCKED`);
    return true;
  }
};

player.ship.destroyed = () => {
  unlockPaint('RED', 'DAMAGED');
};

player.ship.docked = (station: Ship) => {
  player.visitedStations.add(station.id);

  if (player.visitedStations.size > 2) unlockPaint('GREEN', '3 STATION VISITS');
};

mustang.initialLoadout.forEach(({ mount, module }) =>
  player.ship.fit(
    new (moduleTypesById.get(module)!)(),
    player.ship.mounts[mount],
  ),
);

/**
 * Show a message using uppercase characters supported by the font.
 */
export const say = (text: string) => {
  player.note = text;
  player.noteFor = 10;
};

export const readSlate = ({
  message,
  unlock,
}: {
  message: string;
  unlock?: string;
}) => {
  if (unlock) unlockPaint(unlock, 'CARGO FOUND');

  if (player.noteFor > 0) {
    player.queuedNotes.push(message);
  } else {
    say(message);
  }
};

/**
 * dt: Seconds since the last update.
 */
export const updatePlayer = (dt: number) => {
  player.noteFor = Math.max(0, player.noteFor - dt);

  if (!player.noteFor && player.queuedNotes.length) {
    say(player.queuedNotes.shift()!);
  }

  player.hudAlpha = Math.max(
    0,
    Math.min(1, player.hudAlpha + (player.ship.dockedTo ? -2 : 2) * dt),
  );
};

export const adoptPlayerShip = ({ ship }: { ship: Ship }) => {
  const previous = player.ship;

  if (previous !== ship) previous.remove();

  ship.destroyed = previous.destroyed;
  ship.docked = previous.docked;

  ship.networked = 1;
  player.ships[0] = ship;

  if (!game.sprites.includes(ship)) ship.add();
};
