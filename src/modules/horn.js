// Mining horn
// Starts a lineWidth ahead of its mount, so that where a mount sits on the
// hull nose the two strokes touch exactly
import { continuousSound } from '../sound';

const hornBase = 3;
const hornLength = 24;
const hornHalfWidth = 6;

// Gap between flutes, about as wide again as the line itself
const fluteSpacing = 6;

// Steeper than the horn's edges, so the flutes read as cutting across it
const fluteSlope = 2;

const fluteCount = hornLength / fluteSpacing + 2;

// How many times a second the horn turns all the way around
const spinRate = 1.5;

const idleLevel = 4;
const bitingLevel = 8;

// Negative bounciness grips rather than bounces while the horn spins, added to
// whatever the other surface offers rather than overriding it. Small enough
// that it only softens a rebound, not reverse it, since most of what's mined
// is asteroid rather than the rare item that gets grabbed too
// Switched off, the horn says nothing and bounces like the bare hull it is a
// spike on
const grindBounce = -0.2;

/**
 * Flutes are parallel lines that march towards the tip and wrap back around,
 * which is what sells the spin. They are drawn overlong and clipped to the
 * horn, so that they all keep the same angle however wide the horn is there.
 *
 * @param {Object} segment - Holds the rotation of the horn as `phase`, 0 to 1.
 */
const fluteLines = ({ phase }) => Array.from({ length: fluteCount }, (_, i) => {
  const middle = hornBase + (i - 1 + phase) * fluteSpacing;
  const reach = hornHalfWidth / fluteSlope;

  return [
    [middle - reach, -hornHalfWidth],
    [middle + reach, hornHalfWidth],
  ];
});

export const horn = {
  activationDuration: 0.5,
  // Bites while it spins and lets go otherwise, so it does not bounce a ship
  // off what it is mining
  bounciness: (segment) => (segment.activationProgress > 0.5 ? grindBounce : 0),
  // Damage dealt once per fixed game-loop update while its tip is biting
  damage: 0.5,
  // Grinds an asteroid down and cracks it open where it touches a loaded one
  grinds: true,
  health: 100,
  model: [{
    lines: fluteLines,
    points: [[hornBase, -hornHalfWidth], [hornBase + hornLength, 0], [hornBase, hornHalfWidth]],
  }],
  name: 'DRILL',
  price: 350,
  update: (segment, dt) => {
    segment.phase = (segment.phase + dt * spinRate * segment.activationProgress) % 1;

    const active = segment.active && (segment.mount ? segment.mount.health > 0 : true);
    const level = active ? (segment.biting ? bitingLevel : idleLevel) : 0;

    segment.drillSound = continuousSound(segment.drillSound, level);
  },
  zIndex: 1,
};
