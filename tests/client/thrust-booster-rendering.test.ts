import assert from 'node:assert/strict';
import { game } from '../../src/client/game';
import { ThrustBooster } from '../../src/client/objects/modules/thrust-booster';
import type { Module } from '../../src/client/objects/modules/module';
import type { Segment } from '../../src/client/types';
import * as Vec from '../../src/client/utilities/vector';
import { withAlpha } from '../../src/client/utilities/color';
import { colors } from '../../src/specs/colors';

class Path {
  arc() {}
  closePath() {}
  lineTo() {}
  rect() {}
}

const draws: string[] = [];
const strokes: string[] = [];
const rotations: number[] = [];

const glows: {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  stops: [number, string][];
}[] = [];

let source = { x: 0, y: 0, radius: 0, stops: [] as [number, string][] };

let renderingGlow = false;

const context = {
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  lineWidth: 0,
  save() {},
  restore() {},
  translate() {},
  rotate(angle: number) {
    rotations.push(angle);
  },
  fill() {
    if (renderingGlow) {
      glows.push({ ...source, alpha: this.globalAlpha });
    } else {
      draws.push(this.fillStyle);
    }
  },
  stroke() {
    strokes.push(this.strokeStyle);
  },
  beginPath() {},
  arc() {},
  clip() {},
  createRadialGradient(...values: number[]) {
    const stops: [number, string][] = [];

    source = { x: values[3], y: values[4], radius: values[5], stops };

    return {
      addColorStop(offset: number, color: string) {
        stops.push([offset, color]);
      },
    };
  },
};

Object.assign(globalThis, { Path2D: Path });
game.ctx = context as unknown as CanvasRenderingContext2D;

const module = new ThrustBooster();

module.shades = ['#100', '#200', '#300', '#400', '#500'];

module.booster = {
  multiplier: 1.5,
  rampDuration: 0,
  duration: 1,
  cooldown: 1,
  recharge: 14,
  charges: 1,
};

const segments = [0, 1, 2].map((index): Segment => ({
  active: 0,
  activationProgress: 0,
  health: 1,
  hull: false,
  module,
  localPosition: Vec.create(),
  shades: module.shades,
  zIndex: 6,
  rechargeDelay: index * 4 + 2,
  glow: {
    offset: [index * 5, 0],
    radius: 4,
    alpha: 0.2,
    stops: [[0, '#fff']],
  },
}));

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const sampleGlows = (parts = segments) => {
  glows.length = 0;
  renderingGlow = true;

  try {
    parts.forEach((segment) => module.renderGlow({ segment }));
  } finally {
    renderingGlow = false;
  }

  return [...glows];
};

for (const [elapsed, lit] of [
  [0, 0],
  [1.999, 0],
  [2, 1],
  [3.999, 1],
  [4, 2],
  [5.999, 2],
  [6, 3],
  [7.999, 3],
  [8, 4],
  [9.999, 4],
  [10, 5],
  [11.999, 5],
  [12, 6],
  [13, 6],
  [13.799, 6],
  [13.8, 6],
  [13.9, 6],
  [13.999, 6],
  [14, 6],
]) {
  module.chargeCooldown = 14 - elapsed;
  rotations.length = 0;

  const counts = segments.map((segment) => {
    draws.length = 0;
    strokes.length = 0;
    module.render({ segment });
    assert.equal(draws[0], module.shades[0]);
    assert.equal(strokes.at(-1), module.shades[0]);
    return draws.filter((color) => color === module.shades[2]).length;
  });

  assert.deepEqual(
    counts,
    [0, 1, 2].map((index) => Math.max(0, Math.min(2, lit - index * 2))),
    `${elapsed}s: half-discs illuminate at equal intervals`,
  );

  const phase = Math.min(1, (14 - elapsed) / 0.2);
  const angles = rotations.filter((angle) => angle !== 0);

  assert.equal(
    angles.length,
    phase === 1 ? 0 : segments.length,
    'all separators rotate together during the final 200 milliseconds',
  );
  angles.forEach((angle) => near(angle, ((phase - 1) * Math.PI) / 2));
  assert.equal(
    sampleGlows().length,
    elapsed === 14 ? 6 : 0,
    `${elapsed}s: each ready half glows after rotation finishes`,
  );
}

const readyGlow = sampleGlows();

for (const segment of segments) {
  const halves = sampleGlows([segment]);

  assert.equal(halves.length, 2, 'each half has its own glow source');
  assert(
    halves[0].x !== halves[1].x || halves[0].y !== halves[1].y,
    'the half glow sources have separate centers',
  );
}

module.chargeCooldown = 14;
module.fireCooldown = module.booster.duration + module.booster.cooldown;
segments.forEach((segment) => (segment.active = 1));

for (const segment of segments) {
  draws.length = 0;
  module.render({ segment });
  assert.equal(
    draws.filter((color) => color === module.shades[2]).length,
    2,
    'the consumed charge stays lit during its burst',
  );
}

const activeGlow = sampleGlows();

assert.equal(activeGlow.length, 6);
assert(
  activeGlow.every(
    (glow, index) =>
      glow.radius > readyGlow[index].radius &&
      glow.alpha > readyGlow[index].alpha,
  ),
  'the burst glow is larger and brighter than ready glow',
);

// A ready snapshot starts in its completed pose without an extra rotation delay.
module.fireCooldown = 0;
module.chargeCooldown = 0;
assert.equal(sampleGlows().length, 6);

// Sample incoming state across a synthetic burst and its subsequent recharge.
module.booster = { ...module.booster, duration: 2, cooldown: 1, recharge: 4 };

segments.forEach((segment, index) => {
  segment.rechargeDelay = ((index * 2 + 1) * 4) / 7;
});

for (const sample of [
  { time: 0, fire: 3, charge: 4, active: 1, lit: 6, glowing: 6 },
  { time: 1, fire: 2, charge: 4, active: 1, lit: 6, glowing: 6 },
  { time: 1.999, fire: 1.001, charge: 4, active: 1, lit: 6, glowing: 6 },
  { time: 2, fire: 1, charge: 4, active: 0, lit: 0, glowing: 0 },
  { time: 2.5, fire: 0.5, charge: 3.5, active: 0, lit: 0, glowing: 0 },
  { time: 3, fire: 0, charge: 3, active: 0, lit: 1, glowing: 0 },
  { time: 4, fire: 0, charge: 2, active: 0, lit: 3, glowing: 0 },
  { time: 5, fire: 0, charge: 1, active: 0, lit: 5, glowing: 0 },
  { time: 2 + 24 / 7, fire: 0, charge: 4 / 7, active: 0, lit: 6, glowing: 0 },
  { time: 5.8, fire: 0, charge: 0.2, active: 0, lit: 6, glowing: 0 },
  { time: 5.9, fire: 0, charge: 0.1, active: 0, lit: 6, glowing: 0 },
  { time: 5.999, fire: 0, charge: 0.001, active: 0, lit: 6, glowing: 0 },
  { time: 6, fire: 0, charge: 0, active: 0, lit: 6, glowing: 6 },
]) {
  module.fireCooldown = sample.fire;
  module.chargeCooldown = sample.charge;
  segments.forEach((segment) => (segment.active = sample.active));
  draws.length = 0;

  for (const segment of segments) module.render({ segment });

  assert.equal(
    draws.filter((color) => color === module.shades[2]).length,
    sample.lit,
    `${sample.time}s: half-fill starts after the burst ends`,
  );
  assert.equal(
    sampleGlows().length,
    sample.glowing,
    `${sample.time}s: ready glow waits for the full post-burst recharge`,
  );
}

// Painted charge indicators and their glows use the same component palette.
const authoredShade = (ThrustBooster as typeof Module).shades[2];

segments.forEach((segment) => {
  segment.shades = colors.orange;
  segment.glow.stops = [
    [0, authoredShade],
    [0.3, authoredShade, 0.5],
    [1, '#000', 0],
  ];
});

for (const paint of [colors.cyan, undefined]) {
  module.shades = paint;
  const shades = paint || colors.orange;
  const expected = [
    [0, shades[2]],
    [0.3, withAlpha({ color: shades[2], alpha: 0.5 })],
    [1, '#00000000'],
  ];

  for (const boosting of [false, true]) {
    module.fireCooldown = boosting
      ? module.booster.duration + module.booster.cooldown
      : 0;
    module.chargeCooldown = boosting ? module.booster.recharge : 0;
    segments.forEach((segment) => (segment.active = boosting ? 1 : 0));
    const paintedGlows = sampleGlows();

    assert.equal(paintedGlows.length, 6);
    paintedGlows.forEach((glow) =>
      assert.deepEqual(
        glow.stops,
        expected,
        `${paint ? 'module paint' : 'segment fallback'}: ${boosting ? 'burst' : 'ready'} glow matches its painted indicator without changing stop opacity`,
      ),
    );
  }
}
