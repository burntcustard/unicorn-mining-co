import * as Vec from './utilities/vector';
import { Ship } from './objects/ship';
import {
  ThrusterDualMd,
  CargoHatch,
  HornDrill,
  SearchLight,
} from './objects/modules/index';
import { game } from './game';
import { colors, paintColors } from '../definitions/colors';
import { updateThrusterSound } from './audio/sound-loader';
import { type Shades, type Segment } from './types';

export let playerShip = new Ship({
  shades: colors.white,
  position: Vec.create(),
  credits: 500,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
  hudAlpha: 0,
  networked: 1,
}).addToScene();

// @ifdef DEBUG
playerShip.credits = 10000;
// @endif

// Violet is the pink paint in the paint selection.
const unlockedPaints: Shades[] = [colors.violet, colors.white, colors.yellow];
let savedPaintMask: number | undefined;

/**
 * Restore the server's paint choices after joining or receiving progress.
 */
export const syncPaintUnlocks = (mask: number | undefined) => {
  if (mask === undefined || mask === savedPaintMask) return;
  savedPaintMask = mask;
  unlockedPaints.splice(
    0,
    unlockedPaints.length,
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
const visitedStations = new Set<Ship>();
const queuedNotes: string[] = [];

export const paintUnlocked = (shades: Shades) =>
  unlockedPaints.includes(shades);

export const unlockPaint = (color: string, reason: string) => {
  const shades = paintUnlocks.get(color);

  if (shades && !paintUnlocked(shades)) {
    unlockedPaints.push(shades);
    savedPaintMask = undefined;
    say(`${reason} - ${color} UNLOCKED`);
    return true;
  }
};

playerShip.destroyed = () => {
  unlockPaint('RED', 'DAMAGED');
};

playerShip.docked = (station: Ship) => {
  visitedStations.add(station);

  if (visitedStations.size > 2) unlockPaint('GREEN', '3 STATION VISITS');
};

[ThrusterDualMd, CargoHatch, CargoHatch, HornDrill, SearchLight].forEach(
  (Type) => playerShip.fit(new Type()),
);

/**
 * Show a message using uppercase characters supported by the font.
 */
export const say = (text: string) => {
  playerShip.note = text;
  playerShip.noteFor = 10;
};

export const queueNote = (text: string) => {
  if (playerShip.noteFor > 0) queuedNotes.push(text);
  else say(text);
};

export const readSlate = ({
  message,
  unlock,
}: {
  message: string;
  unlock?: string;
}) => {
  if (unlock) unlockPaint(unlock, 'CARGO FOUND');

  queueNote(message);
};

/**
 * dt: Seconds since the last update.
 */
export const updatePlayer = (dt: number) => {
  playerShip.noteFor = Math.max(0, playerShip.noteFor - dt);

  if (!playerShip.noteFor && queuedNotes.length) say(queuedNotes.shift()!);

  playerShip.hudAlpha = Math.max(
    0,
    Math.min(1, playerShip.hudAlpha + (playerShip.dockedTo ? -2 : 2) * dt),
  );

  // Normalize the replicated spin against the same steering limit used by the
  // simulation. Steering effort also covers braking and reversing direction.
  const turningSpeed =
    ((playerShip.spin as number) * 16) /
    ((playerShip.turnRate as number) *
      (playerShip.rotationalThrust as number) *
      (playerShip.launchThrottle as number) ** 2 || 1);
  const steeringEffort = Math.min(1, Math.abs(playerShip.turn - turningSpeed));
  const engineLoad = Math.min(
    1,
    Math.max(
      Vec.length(playerShip.velocity) / playerShip.maxSpeed,
      Math.abs(turningSpeed),
      steeringEffort * 0.65,
    ),
  );

  updateThrusterSound(
    !playerShip.dead && !playerShip.dockedTo && playerShip.engine.mount
      ? Math.max(
          steeringEffort * playerShip.launchThrottle,
          ...playerShip.segments
            .filter((segment: Segment) => segment.module === playerShip.engine)
            .map((segment: Segment) => segment.active),
        )
      : 0,
    engineLoad,
  );
};

export const adoptPlayerShip = ({ ship }: { ship: Ship }) => {
  const previous = playerShip;

  if (previous !== ship) previous.remove();

  Object.assign(ship, {
    credits: previous.id < 0 ? previous.credits : ship.credits,
    note: previous.note,
    noteFor: previous.noteFor,
    hudAlpha: previous.hudAlpha,
    started: previous.started,
    destroyed: previous.destroyed,
    docked: previous.docked,
  });

  ship.networked = 1;
  playerShip = ship;

  if (!game.sprites.includes(ship)) ship.add();
};
