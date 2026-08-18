import { circlePath } from './drawing';
import { colors } from './colors';

// Where the light in this part of space comes from, in radians
export const lightAngle = -Math.PI / 4;

// How far a station has to turn before its shading is worth working out again.
// One turn takes a couple of minutes, so redoing it every frame is waste
export const shadingStep = 0.02;

// How far along the ramp a piece runs between its lit and its shaded side.
// Enough that neighbouring pieces meet at about the same tone rather than
// stepping from one to the next
const spread = 0.2;

// How much of the ramp gets used at all. Below one, pieces keep to the middle
// of it, so no two of them are wildly far apart
const contrast = 0.8;

// How a bare hull falls away from the light: bleached where it faces it,
// through the colours the nebula throws back at it, down to nearly the dark of
// space. The last stop is the rim, where a plate facing right away catches the
// light coming round behind and lifts it off the background
const lightRamp = [
  [0, colors.white[2]],
  [0.3, colors.white[0]],
  [0.55, colors.pink[1]],
  [0.75, colors.indigo[0]],
  [0.93, colors.purple[1]],
  [1, colors.cyan[2]],
];

// Ships are painted to be told apart at a glance, so the light only tints what
// they are already wearing rather than replacing it the way it does bare hull.
// The lit side is lifted towards white and then given a push towards the
// colour's own light, since tinting a pale colour straight at a hue only
// darkens it. The shaded side falls towards the colour's own shadow
const litTint = 0.32;
const warmTint = 0.2;
const shadeTint = 0.2;

// How far a thruster's glow spills past its flame at full burn, in game units,
// and how brightly. Close in and gentle, so the flame stays a shape rather
// than turning into a cloud
const haloReach = 45;
const haloStrength = 0.45;

// Palette colours are one hex digit a channel. Spreading them over a whole
// byte before blending is what lets two pale colours meet somewhere other than
// on one of the sixteen steps they started on
const parse = (color) => [1, 2, 3].map((i) => parseInt(color[i], 16) * 17);
const mix = (from, to, amount) => from.map((was, i) => was + (to[i] - was) * amount);
const hex = (channels) => `#${channels
  .map((level) => Math.round(level).toString(16).padStart(2, '0'))
  .join('')}`;

const white = parse(colors.white[2]);

/**
 * The ramp as a colour, anywhere along it rather than only at its stops.
 *
 * @param {Number} at - 0 facing the light, 1 facing right away from it.
 */
const blend = (at) => {
  const next = lightRamp.findIndex(([stop]) => stop >= at);
  const [to, color] = lightRamp[next];
  const [from, before] = lightRamp[next - 1] || lightRamp[next];

  return to === from ? color : hex(mix(parse(before), parse(color), (at - from) / (to - from)));
};

// Shading is worked out up front and looked up, rather than colours being
// built out of strings on every frame of every piece of every craft
const steps = 64;
const at = (along) => Math.round(Math.min(1, Math.max(0, along)) * (steps - 1));
const table = (shade) => Array.from({ length: steps }, (_, i) => shade(i / (steps - 1)));

const ramp = table(blend);
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
 * Bare hull, which takes its colour entirely from the light.
 *
 * @param {Number} along - 0 facing the light, 1 facing right away from it.
 */
export const sample = (along) => ramp[at(along)];

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
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, haloReach);

  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, `${color}6`);
  gradient.addColorStop(1, '#0000');

  return gradient;
};

// Sat at the origin and sized to one full burn, so it is the same bloom for
// every nozzle burning a given colour and worth keeping hold of
const haloPath = circlePath(haloReach);
const haloFill = (ctx, color) => (halos[color] ||= haloOf(ctx, color));

/**
 * The glow a burning nozzle throws around its flame, meant to go down before
 * its craft so that the hull covers the heart of it.
 *
 * @param {CanvasRenderingContext2D} ctx - Already in the craft's own frame.
 * @param {Object} nozzle
 */
export const drawHalo = (ctx, nozzle) => {
  // The same figure that sizes the flare, so the two grow and die together
  const level = nozzle.anim * Math.sqrt(nozzle.power);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = level * haloStrength;
  ctx.translate(nozzle.x, nozzle.y);
  ctx.scale(level, level);
  ctx.fillStyle = haloFill(ctx, nozzle.shades[2]);
  ctx.fill(haloPath);
  ctx.restore();
};
