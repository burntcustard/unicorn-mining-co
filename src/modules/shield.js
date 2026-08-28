import { Vector, movePoint } from '../vector';
import { circlePath } from '../drawing';

// Shield
// A dial on the hull it protects, with a cross inside it that spins while the
// shield is up, and a bubble around the whole ship that is only there while it
// is up. Anything inside the bubble is hit through the bubble, not directly
const radius = 7;

// Wide enough to take in the hull and its modules from wherever it is mounted
const bubbleRadius = 50;

// How fast the cross turns while the shield is up, in radians a second
const spinRate = 3;

const dial = circlePath(radius);

// One line of the cross, straight through the middle of the dial
const arm = (angle) => {
  const point = movePoint(Vector(), angle, radius);

  return [[-point.x, -point.y], [point.x, point.y]];
};

export const shield = {
  bounciness: 0.4,
  health: 40,
  key: 's',
  name: 'SHIELD',
  model: [
    {
      lines: ({ phase }) => [arm(phase), arm(phase + Math.PI / 2)],
      path: () => dial,
      radius: () => radius,
    },
    {
      // A quarter of a second from nothing to full size, and the same back
      activationDuration: 0.2,
      covers: true,
      // The bubble swells out of the dial as it comes up, and sinks back into
      // it on the way down
      path: ({ anim }) => anim && circlePath(bubbleRadius * anim),
      // With no outline to test it is simply a circle, and while it is
      // swelling out it can already shove things clear
      radius: ({ anim }) => bubbleRadius * anim,
      fillAlpha: 2,
    },
  ],
  price: 900,
  state: () => ({ phase: 0 }),
  // A quarter turn brings the cross back around to where it started
  update: (segment, dt) => {
    segment.phase = (segment.phase + dt * spinRate * segment.anim) % (Math.PI / 2);
  },
  zIndex: 1,
};
