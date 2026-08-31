// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';
// @endif
import { circlePath } from './drawing';
import { colors } from './colors';
import { game } from './game';

// Profiling switches kept separate from module state, so lamps and engines
// carry on running while either kind of light is hidden.
// @ifdef DEBUG
export let glows = true;
export let lights = true;
export const toggleGlows = () => glows = !glows;
export const toggleLights = () => lights = !lights;
// @endif

// Where the light in this part of space comes from, in radians
export const lightAngle = -Math.PI / 4;

// How far a station has to turn before its shading is worth working out again.
// One turn takes a couple of minutes, so redoing it every frame is waste
export const shadingStep = 0.02;

// How far along its range a piece runs between its lit and its shaded side.
// Enough that neighbouring pieces meet at about the same tone rather than
// stepping from one to the next
const spread = 0.2;

// How much of that range gets used at all. Below one, pieces keep to the middle
// of it, so no two of them are wildly far apart
const contrast = 0.8;

// Craft are painted to be told apart at a glance, so the light only tints what
// they are already wearing rather than replacing it. The lit side is lifted
// towards white and then given a push towards the colour's own light, since
// tinting a pale colour straight at a hue only darkens it. The shaded side
// falls towards the colour's own shadow
const litTint = 0.32;
const warmTint = 0.2;
const shadeTint = 0.2;

// How far a thruster's glow spills past its flame at full burn, in game units,
// and how brightly. Close in and gentle, so the flame stays a shape rather
// than turning into a cloud
const haloReach = 45;
const haloStrength = 0.45;

// How far a lit shape's own glow carries past its edges, in screen pixels. A
// blur is not put through the transform the way a path is, so this does not
// grow and shrink with the view
const glowBlur = 40;

// How much of its length a beam holds full strength for, and how hard it lifts
// whatever it falls on
const beamCore = 0.15;
const beamStrength = 0.55;

// Palette colours are one hex digit a channel. Spreading them over a whole
// byte before blending is what lets two pale colours meet somewhere other than
// on one of the sixteen steps they started on
const parse = (color) => [1, 2, 3].map((i) => parseInt(color[i], 16) * 17);
const mix = (from, to, amount) => from.map((was, i) => was + (to[i] - was) * amount);
const hex = (channels) => `#${channels
  .map((level) => Math.round(level).toString(16).padStart(2, '0'))
  .join('')}`;

const white = parse(colors.white[2]);

// Shading is worked out up front and looked up, rather than colours being
// built out of strings on every frame of every piece of every craft
const steps = 64;
const at = (along) => Math.round(Math.min(1, Math.max(0, along)) * (steps - 1));
const table = (shade) => Array.from({ length: steps }, (_, i) => shade(i / (steps - 1)));

const tints = {};
const halos = {};

const shadeOf = (shades, worn) => {
  const base = parse(shades[worn]);
  const shadow = parse(shades[3]);
  const light = parse(shades[4]);

  return table((along) => {
    const towards = (along - 0.5) * 2;

    if (towards > 0) return hex(mix(base, shadow, towards * shadeTint));

    return hex(mix(mix(base, white, -towards * litTint), light, -towards * warmTint));
  });
};

/**
 * Painted work, which keeps its colour and is only lightened or darkened.
 *
 * @param {String[]} shades - The colour the piece is painted.
 * @param {Number} worn - Which of its shades the piece is currently wearing.
 * @param {Number} along - 0 facing the light, 1 facing right away from it.
 */
export const tint = (shades, worn, along) => (
  tints[shades[worn]] ||= shadeOf(shades, worn)
)[at(along)];

/**
 * What shading a piece needs to know about itself, worked out once when it is
 * built rather than every time it is drawn.
 *
 * @param {Number[][]} points - Outline, relative to wherever it is mounted.
 * @param {Object} [mount] - Where on the craft the piece sits.
 */
export const shapeOf = (points, mount) => {
  const middle = points
    .reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
    .map((total) => total / points.length);

  return {
    // Which way the piece looks, taken as the way out from the middle of the
    // craft towards the middle of the piece
    facing: Math.atan2(middle[1] + (mount?.y || 0), middle[0] + (mount?.x || 0)),
    middle,
    // How far it reaches from its own middle, which is how wide its shading
    // has to run
    reach: Math.max(...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1]))),
  };
};

/**
 * A piece shaded across its own width, running from the edge of it nearest the
 * light to the edge furthest away. Where along the ramp that slice falls is
 * set by how squarely the piece faces the light to begin with, which is what
 * gives a craft its form.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} shape - Anything built with a facing, middle and reach.
 * @param {Number} light - Which way the light lies, in the craft's own turned
 *   frame rather than the world's.
 * @param {Function} shade - Turns a place on the ramp into a colour.
 */
export const litFill = (ctx, shape, light, shade) => {
  // @ifdef BENCHMARK
  if (benchmarkFlag('noLighting') || benchmarkFlag('noGradients')) {
    return shade(0.5);
  }
  // @endif

  const [middleX, middleY] = shape.middle;
  const towardsX = Math.cos(light) * shape.reach;
  const towardsY = Math.sin(light) * shape.reach;
  const facing = (1 - Math.cos(shape.facing - light)) / 2;
  const along = 0.5 + (facing - 0.5) * contrast;
  const gradient = ctx.createLinearGradient(
    middleX + towardsX,
    middleY + towardsY,
    middleX - towardsX,
    middleY - towardsY,
  );

  gradient.addColorStop(0, shade(along - spread));
  gradient.addColorStop(1, shade(along + spread));

  return gradient;
};

const haloOf = (ctx, color) => {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, `${color}6`);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

// A unit circle at the origin, so it is the same pool for everything glowing a
// given colour and worth keeping hold of. Callers scale it to the size they
// want rather than each having one of their own
const haloPath = circlePath(1);
const haloFill = (ctx, color) => (halos[color] ||= haloOf(ctx, color));

/**
 * A pool of light shaped like whatever is lit up, blurred out past its own
 * edges. Meant to go down before the thing itself, so that what is drawn on
 * top covers the heart of it.
 *
 * @param {CanvasRenderingContext2D} ctx - Already in the craft's own frame.
 * @param {Path2D} path
 * @param {String} color
 * @param {Number} strength
 * @param {Number[][]} [cache]
 */
export const drawGlow = (ctx, path, color, strength, cache) => {
  // @ifdef DEBUG
  if (!glows) return;
  // @endif
  // @ifdef BENCHMARK
  if (benchmarkFlag('noLighting') || benchmarkFlag('noGlows')) return;
  // @endif

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;

  // @ifdef BENCHMARK
  if (benchmarkFlag('noBlur')) cache = null;
  // @endif

  if (cache) {
    const { scale } = game;

    if (!cache.image || cache.scale !== scale) {
      const radius = Math.max(...cache.map(([x, y]) => Math.hypot(x, y)));
      const reach = radius * scale + glowBlur * 2;
      const image = document.createElement('canvas');
      const paint = image.getContext('2d');

      image.width = image.height = reach * 2;
      paint.translate(reach, reach);
      paint.scale(scale, scale);
      paint.shadowBlur = glowBlur;
      paint.shadowColor = paint.fillStyle = color;
      paint.fill(path);
      cache.image = image;
      cache.scale = scale;
    }

    const size = cache.image.width / cache.scale;

    ctx.drawImage(cache.image, -size / 2, -size / 2, size, size);
  } else {
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noBlur')) {
    // @endif
      ctx.shadowBlur = glowBlur;
      ctx.shadowColor = color;
    // @ifdef BENCHMARK
    }
    // @endif

    ctx.fillStyle = color;
    ctx.fill(path);
  }

  ctx.restore();
};

/**
 * The light a lamp throws out in front of it: full at the lens and gone by the
 * far end of its reach. Its translucent wash tints what is underneath without
 * additive blending making bright points flare up.
 *
 * @param {CanvasRenderingContext2D} ctx - Already in the craft's own frame.
 * @param {Path2D} path
 * @param {String} color
 * @param {Number} reach - How far the beam carries at full strength.
 * @param {Number} activationProgress - How far up the lamp has come, 0 to 1.
 * @param {Path2D} lit - How far the light got before it ran into anything.
 */
export const drawBeam = (ctx, path, color, reach, activationProgress, lit) => {
  // @ifdef DEBUG
  if (!lights) return;
  // @endif
  // @ifdef BENCHMARK
  if (benchmarkFlag('noLighting') || benchmarkFlag('noBeam')) return;
  // @endif

  const gradient = ctx.createLinearGradient(0, 0, reach, 0);

  gradient.addColorStop(0, color);
  gradient.addColorStop(beamCore, `${color}c`);
  gradient.addColorStop(1, '#0000');

  ctx.save();
  // The cone says how wide the beam is and the trace says how far it got, so
  // one is filled through the other
  ctx.clip(lit);
  ctx.globalAlpha = activationProgress * beamStrength;

  // Cast off the beam rather than laid down under it, so it gives out along
  // with the light. A glow of its own has no idea how far down the beam it is
  // and ends in a hard edge wherever the light happens to stop
  // @ifdef BENCHMARK
  if (!benchmarkFlag('noBlur')) {
  // @endif
    ctx.shadowBlur = glowBlur;
    ctx.shadowColor = color;
  // @ifdef BENCHMARK
  }
  // @endif

  ctx.fillStyle = gradient;
  ctx.fill(path);
  ctx.restore();
};

/**
 * The glow a burning nozzle throws around its flame. Round rather than shaped,
 * because a flame is a bright point and there are a lot of them.
 *
 * @param {CanvasRenderingContext2D} ctx - Already in the craft's own frame.
 * @param {Object} nozzle
 */
export const drawHalo = (ctx, nozzle) => {
  // @ifdef DEBUG
  if (!glows) return;
  // @endif
  // @ifdef BENCHMARK
  if (benchmarkFlag('noLighting') || benchmarkFlag('noHalos')) return;
  // @endif

  // The same figure that sizes the flare, so the two grow and die together
  const strength = nozzle.activationProgress * Math.sqrt(nozzle.power);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength * haloStrength;
  ctx.translate(nozzle.x, nozzle.y);
  ctx.scale(strength * haloReach, strength * haloReach);
  ctx.fillStyle = haloFill(ctx, nozzle.shades[2]);
  ctx.fill(haloPath);
  ctx.restore();
};
