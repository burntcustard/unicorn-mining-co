import * as Vec from '../shared/vector';
import { Ship } from '../shared/craft/ship';
import {
  ThrusterDualMd,
  CargoHatch,
  HornDrill,
  SearchLight,
} from '../shared/modules';
import { game } from './game';
import { createRenderedShip } from './create-rendered-ship';
import { colors } from '../shared/colors';
import { updateThrusterSound } from './sound-loader';
import { type Shades, type Segment } from '../shared/types';

export let playerShip = createRenderedShip({
  shades: colors.white,
  position: Vec.create(),
  credits: 500,
  // The last thing worth telling the pilot about, and how long it has left on
  // screen. Anything can set this, so a station can talk as well as a message
  note: '',
  noteFor: 0,
  hudAlpha: 0,
  networked: 1,
});

// @ifdef DEBUG
playerShip.credits = 10000;
// @endif

// Violet is the pink paint in the paint selection, and only it and white are available
// until the pilot has earned the rest.
const unlockedPaints: Shades[] = [colors.violet, colors.white];
const paintUnlocks = new Map<string, Shades>([
  ['RED', colors.red],
  ['ORANGE', colors.orange],
  ['YELLOW', colors.yellow],
  ['GREEN', colors.green],
  ['CYAN', colors.cyan],
]);
const visitedStations = new Set<Ship>();

export const paintUnlocked = (shades: Shades) =>
  unlockedPaints.includes(shades);

export const unlockPaint = (color: string, reason: string) => {
  const shades = paintUnlocks.get(color);

  if (shades && !paintUnlocked(shades)) {
    unlockedPaints.push(shades);
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

/**
 * dt: Seconds since the last update.
 */
export const updatePlayer = (dt: number) => {
  playerShip.noteFor = Math.max(0, playerShip.noteFor - dt);
  playerShip.hudAlpha = Math.max(
    0,
    Math.min(1, playerShip.hudAlpha + (playerShip.dockedTo ? -2 : 2) * dt),
  );

  if (Vec.length(playerShip.position) >= 5e4) {
    unlockPaint('YELLOW', 'EDGE REACHED');
  }

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
