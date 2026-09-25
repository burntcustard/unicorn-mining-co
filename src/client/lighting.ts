// @ifdef BENCHMARK
import { benchmarkFlag } from './benchmark';

// @endif
import { colors } from '../shared/colors';
import { Craft } from '../shared/craft/craft';
import { type GameObject } from '../shared/game-object';
import * as Vec from '../shared/vector';
import { camera } from './camera';
import { insidePath, traceBeam } from './prism';
import { game } from './game';
import { pointBetween as mix } from '../shared/geometry';
import { type Shades } from '../shared/types';

type GlowCache = { image?: HTMLCanvasElement; scale?: number };
interface LitShape {
  // Facing angle and centre in the craft's local frame.
  facing?: number;
  middle?: number[];
  reach?: number;
}

// Profiling switches kept separate from module state, so lamps and engines
// carry on running while either kind of light is hidden.
// @ifdef DEBUG
export let glows = true;
export let lights = true;
export const toggleGlows = () => (glows = !glows);
export const toggleLights = () => (lights = !lights);
// @endif

// Where the light in this part of space comes from, in radians
export const lightAngle = -Math.PI / 4;

// How far along its range a piece runs between its lit and its shaded side.
// Enough that neighbouring pieces meet at about the same tone rather than
// stepping from one to the next
const spread = 0.2;

// Craft are painted to be told apart at a glance, so the light only tints what
// they are already wearing rather than replacing it. The lit side is lifted
// towards white and then given a push towards the colour's own light, since
// tinting a pale colour straight at a hue only darkens it. The shaded side
// falls towards the colour's own shadow
const litTint = 0.32;
const warmTint = 0.2;
const shadeTint = 0.2;

// How far a lit shape's own glow carries past its edges, in screen pixels. A
// blur is not put through the transform the way a path is, so this does not
// grow and shrink with the view
const glowBlur = 40;

// Shades are one hex digit a channel. Spreading them over a whole
// byte before blending is what lets two pale colours meet somewhere other than
// on one of the sixteen steps they started on
// Parsing '#' too creates an unused NaN channel that travels through blending.
// Dropping it in hex saves a few bytes over selecting just the RGB digits here.
const parse = (color: string) =>
  // oxlint-disable-next-line typescript/no-misused-spread -- Colours are internally generated ASCII hex strings.
  [...color].map((channel) => parseInt(channel, 16) * 17);
const hex = (channels: number[]) =>
  `#${channels
    .map((level) => Math.round(level).toString(16).padStart(2, '0'))
    .slice(1)
    .join('')}`;

const white = parse(colors.white[2]);

// Shading is worked out up front and looked up, rather than colours being
// built out of strings on every frame of every piece of every craft
const at = (along: number) => Math.round(Math.min(1, Math.max(0, along)) * 63);
const table = (shade: (along: number) => string) =>
  Array.from({ length: 64 }, (_, i) => shade(i / 63));

const tints: Record<string, string[]> = {};

const shadeOf = (shades: Shades, worn: number) => {
  const base = parse(shades[worn]);

  return table((along) => {
    const towards = (along - 0.5) * 2;

    if (towards > 0) {
      return hex(mix(base, parse(shades[3]), towards * shadeTint));
    }

    return hex(
      mix(
        mix(base, white, -towards * litTint),
        parse(shades[4]),
        -towards * warmTint,
      ),
    );
  });
};

/**
 * Painted work, which keeps its colour and is only lightened or darkened.
 *
 * shades: The colour the piece is painted.
 * worn: Which of its shades the piece is currently wearing.
 * along: 0 facing the light, 1 facing right away from it.
 */
export const tint = (shades: Shades, worn: number, along: number) =>
  (tints[shades[worn]] ||= shadeOf(shades, worn))[at(along)];

/**
 * A piece shaded across its own width, running from the edge of it nearest the
 * light to the edge furthest away. Where along the ramp that slice falls is
 * set by how squarely the piece faces the light to begin with, which is what
 * gives a craft its form.
 *
 * shape: Anything built with a facing, middle and reach.
 * light: Which way the light lies, in the craft's own turned
 *   frame rather than the world's.
 * shade: Turns a place on the ramp into a colour.
 */
export const litFill = (
  ctx: CanvasRenderingContext2D,
  shape: LitShape,
  light: number,
  shade: (along: number) => string,
) => {
  // @ifdef BENCHMARK
  if (benchmarkFlag('noLighting') || benchmarkFlag('noGradients')) {
    return shade(0.5);
  }
  // @endif

  const [middleX, middleY] = shape.middle!;
  const towardsX = Math.cos(light) * shape.reach;
  const towardsY = Math.sin(light) * shape.reach;
  const along = 0.5 - Math.cos(shape.facing - light) * 0.4;
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

/**
 * A cached pool of light around a docking bay piece. Meant to go down before
 * the thing itself, so that what is drawn on top covers the heart of it.
 *
 * ctx: Already in the craft's own frame.
 */
export const drawDockingBayGlow = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  cache: GlowCache,
) => {
  // @ifdef DEBUG
  if (!glows) return;
  // @endif
  // @ifdef BENCHMARK

  if (benchmarkFlag('noLighting') || benchmarkFlag('noGlows')) return;
  // @endif

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.2;

  if (cache.scale !== game.scale) {
    // The station bay fits within 280 world units of its local origin.
    const reach = 280 * game.scale + glowBlur * 2;
    const image = document.createElement('canvas');
    const paint = image.getContext('2d')!;

    image.width = image.height = reach * 2;
    paint.translate(reach, reach);
    paint.scale(game.scale, game.scale);
    paint.shadowBlur = glowBlur;
    paint.shadowColor = paint.fillStyle = color;
    paint.fill(path);
    cache.image = image;
    cache.scale = game.scale;
  }

  const size = cache.image!.width / game.scale;

  ctx.drawImage(cache.image!, -size / 2, -size / 2, size, size);

  ctx.restore();
};

/**
 * The light a lamp throws out in front of it: full at the lens and gone by the
 * far end of its reach. Its translucent wash tints what is underneath without
 * additive blending making bright points flare up.
 *
 * ctx: Already in the craft's own frame.
 * reach: How far the beam carries at full strength.
 * activationProgress: How far up the lamp has come, 0 to 1.
 * lit: How far the light got before it ran into anything.
 */
export const drawBeam = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  reach: number,
  activationProgress: number,
  lit: Path2D,
) => {
  // @ifdef DEBUG
  if (!lights) return;
  // @endif
  // @ifdef BENCHMARK

  if (benchmarkFlag('noLighting') || benchmarkFlag('noBeam')) return;
  // @endif

  const gradient = ctx.createLinearGradient(0, 0, reach, 0);

  gradient.addColorStop(0, color);
  gradient.addColorStop(0.15, `${color}c`);
  gradient.addColorStop(1, '#0000');

  ctx.save();
  // The cone says how wide the beam is and the trace says how far it got, so
  // one is filled through the other
  ctx.clip(lit);
  ctx.globalAlpha = activationProgress * 0.5;

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

// Both local and remote beams reveal the contents of rock they cross.
export const revealBuriedItems = ({
  sprites,
  predicted,
  poses,
}: {
  sprites: GameObject[];
  predicted: ReadonlyMap<number, GameObject>;
  poses: ReadonlyMap<number, { position: Vec.Value; rotation: number }>;
}) => {
  const asteroids = sprites.filter(
    (sprite) => sprite.scenery && sprite.segments && sprite.renderContents,
  );

  if (!asteroids.length) return;

  const { ctx, scale } = game;

  sprites.forEach((sprite) => {
    if (!(sprite instanceof Craft) || sprite.dead) return;
    const prediction = predicted.get(sprite.id);
    const craft = prediction instanceof Craft ? prediction : sprite;
    const pose = poses.get(sprite.id) || craft;

    craft.segments.forEach((lamp) => {
      if (
        !lamp.module.beam ||
        lamp.activationProgress <= 0.5 ||
        (lamp.mount || lamp).health < 1
      ) {
        return;
      }

      const beam = lamp.prism || traceBeam(pose, lamp, sprites);

      ctx.save();
      ctx.translate(pose.position.x, pose.position.y);
      ctx.rotate(pose.rotation);
      ctx.translate(lamp.localPosition.x, lamp.localPosition.y);
      ctx.clip(insidePath(beam));
      ctx.clip(beam.mask);
      ctx.resetTransform();
      ctx.scale(scale, scale);
      ctx.translate(-camera.x, -camera.y);

      asteroids.forEach((asteroid) =>
        asteroid.renderContents.forEach((item: GameObject) => item.render()),
      );

      ctx.restore();
    });
  });
};
