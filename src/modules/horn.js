// Mining horn
// Starts a lineWidth ahead of its mount, so that where a mount sits on the
// hull nose the two strokes touch exactly
import { zzfx } from '../sound';

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

// Contact right at an asteroid's edge can flicker on and off between ticks as
// physics resolves it; the biting sound only follows a change once it has
// held for this long, so that flicker doesn't restart (and click) every tick
const bitingDebounce = 0.1;

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
  // Also doubles as the idle/biting sound crossfade length, so switching
  // sounds takes as long as the drill itself takes to spin up or down
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

    segment.bitingFor = segment.biting === segment.wasChecked ? (segment.bitingFor || 0) + dt : 0;
    segment.wasChecked = segment.biting;

    const settledBiting = segment.bitingFor > bitingDebounce ? segment.biting : segment.wasBiting;

    // Loops for as long as the drill is switched on, not just while it bites,
    // but swaps to the louder, crunchier grind sound while it actually is
    if (segment.activationProgress > 0.5) {
      if (!segment.drillSound || settledBiting !== segment.wasBiting) {
        // drillSound is reset to the falsy sentinel 0, not null/undefined, so
        // `?.` wouldn't short-circuit here
        if (segment.drillSound) segment.drillSound.stop();
        // Noise read as abrasive static no matter how it was smoothed. A low
        // triangle tone reads as a continuous engine purr instead - zero
        // sustain makes the envelope a plain fade in/out that starts and ends
        // at zero, so the loop has no seam to click or thump at, and no
        // randomness so the pitch doesn't shift on every restart. Crossfades
        // over the same time the drill itself takes to spin up/down
        segment.drillSound = zzfx(settledBiting ? 0.2 : 0.07, 0, settledBiting ? 25 : 35, 0.015, 0, 0.015, 1, 0.5, 1 / segment.rate);
        segment.drillSound.loop = true;
        segment.wasBiting = settledBiting;
      }
    } else if (segment.drillSound) {
      segment.drillSound.stop();
      segment.drillSound = segment.wasBiting = segment.bitingFor = 0;
    }
  },
  zIndex: 1,
};
