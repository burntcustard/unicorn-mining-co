import { composedSurfaces } from './composited-surface';
import { withAlpha } from './color';
import {
  lightAngle,
  spread,
  litTint,
  warmTint,
  shadeTint,
  glowBlur,
} from '../../specs/lighting';

// @ifdef BENCHMARK
import { benchmarkFlag } from '../debug/benchmark';

// @endif
import { colors } from '../../specs/colors';
import { Craft } from '../objects/craft';
import { type GameObject } from '../objects/game-object';
import { insidePath, insideBounds, traceBeam } from './prism';
import { pointBetween as mix, rotatePoint } from './geometry';
import * as Vec from './vector';
import { game } from '../game';
import { type Pose, type Segment, type Shades } from '../types';

type GlowCache = number[][] & {
  image?: HTMLCanvasElement | ImageBitmap;
  scale?: number;
  left?: number;
  top?: number;
};

type BeamImages = {
  images: Map<string, HTMLCanvasElement | ImageBitmap>;
  scale: number;
};

const beamImages = new WeakMap<Path2D, BeamImages>();
let revealSurface: HTMLCanvasElement;

interface LitShape {
  // Facing angle and center in the craft's local frame.
  facing?: number;
  middle?: number[];
  reach?: number;
}

// The lighting debug switch is separate from module state.
// @ifdef DEBUG
export let lights = true;
export const toggleLights = () => (lights = !lights);
// @endif

// Where the light in this part of space comes from, in radians

// How far along its range a piece runs between its lit and its shaded side.
// Enough that neighbouring pieces meet at about the same tone rather than
// stepping from one to the next

// Craft are painted to be told apart at a glance, so the light only tints what
// they are already wearing rather than replacing it. The lit side is lifted
// toward white and then given a push toward the color's own light, since
// tinting a pale color straight at a hue only darkens it. The shaded side
// falls toward the color's own shadow

// How far a lit shape's own glow carries past its edges, in screen pixels. A
// blur is not put through the transform the way a path is, so this does not
// grow and shrink with the view

// Shades are one hex digit a channel. Spreading them over a whole
// byte before blending is what lets two pale colors meet somewhere other than
// on one of the sixteen steps they started on
// Parsing '#' too creates an unused NaN channel that travels through blending.
// Dropping it in hex saves a few bytes over selecting just the RGB digits here.
const parse = (color: string) =>
  // oxlint-disable-next-line typescript/no-misused-spread -- Colors are internally generated ASCII hex strings.
  [...color].map((channel) => parseInt(channel, 16) * 17);
const hex = (channels: number[]) =>
  `#${channels
    .map((level) => Math.round(level).toString(16).padStart(2, '0'))
    .slice(1)
    .join('')}`;

const white = parse(colors.white[2]);

// Shading is worked out up front and looked up, rather than colors being
// built out of strings on every frame of every piece of every craft
const at = (along: number) => Math.round(Math.min(1, Math.max(0, along)) * 63);
const table = (shade: (along: number) => string) =>
  Array.from({ length: 64 }, (_, i) => shade(i / 63));

const tints: Record<string, string[]> = {};

const shadeOf = (shades: Shades, worn: number) => {
  const base = parse(shades[worn]);

  return table((along) => {
    const toward = (along - 0.5) * 2;

    if (toward > 0) {
      return hex(mix(base, parse(shades[3]), toward * shadeTint));
    }

    return hex(
      mix(
        mix(base, white, -toward * litTint),
        parse(shades[4]),
        -toward * warmTint,
      ),
    );
  });
};

/**
 * Painted work, which keeps its color and is only lightened or darkened.
 *
 * shades: The color the piece is painted.
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
 * shade: Turns a place on the ramp into a color.
 */
const gradientImages = new Map<string, HTMLCanvasElement>();
const gradientPatterns = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasPattern>
>();

/*
 * Store a linear ramp once and transform its pattern with the hull. The 256
 * samples cover the ramp plus clamped margins; the world canvas stays native.
 */
const gradientPattern = (
  ctx: CanvasRenderingContext2D,
  first: string,
  last: string,
) => {
  const key = `${first}/${last}`;
  let patterns = gradientPatterns.get(ctx);

  if (!patterns) gradientPatterns.set(ctx, (patterns = new Map()));
  let pattern = patterns.get(key);

  if (!pattern) {
    let image = gradientImages.get(key);

    if (!image) {
      image = document.createElement('canvas');
      image.width = 256;
      image.height = 1;
      const paint = image.getContext('2d');
      const ramp = paint.createLinearGradient(256 / 6, 0, (256 * 5) / 6, 0);

      ramp.addColorStop(0, first);
      ramp.addColorStop(1, last);
      paint.fillStyle = ramp;
      paint.fillRect(0, 0, 256, 1);

      if (gradientImages.size === 128) {
        gradientImages.delete(gradientImages.keys().next().value);
      }

      gradientImages.set(key, image);
    }

    pattern = ctx.createPattern(image, 'repeat-y');

    if (patterns.size === 128) patterns.delete(patterns.keys().next().value);
    patterns.set(key, pattern);
  }

  return pattern;
};

const litFill = (
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
  const towardX = Math.cos(light) * shape.reach;
  const towardY = Math.sin(light) * shape.reach;
  const along = 0.5 - Math.cos(shape.facing - light) * 0.4;

  if (composedSurfaces(ctx)) {
    const pattern = gradientPattern(
      ctx,
      shade(along - spread),
      shade(along + spread),
    );
    const ratio = 3 / 256;

    pattern.setTransform({
      a: -towardX * ratio,
      b: -towardY * ratio,
      c: towardY,
      d: -towardX,
      e: middleX + towardX * 1.5,
      f: middleY + towardY * 1.5,
    });

    return pattern;
  }

  const gradient = ctx.createLinearGradient(
    middleX + towardX,
    middleY + towardY,
    middleX - towardX,
    middleY - towardY,
  );

  gradient.addColorStop(0, shade(along - spread));
  gradient.addColorStop(1, shade(along + spread));

  return gradient;
};

/**
 * The fill for a crewed craft's hull segment, lit as the craft is turned.
 */
export const hullSegmentFill = ({
  ctx,
  segment,
  worn,
  rotation,
}: {
  ctx: CanvasRenderingContext2D;
  segment: Segment;
  worn: number;
  rotation: number;
}) => {
  if (segment.fillAlpha !== undefined) {
    return withAlpha({ color: segment.shades[2], alpha: segment.fillAlpha });
  }

  if (!segment.middle) return segment.shades[worn];
  // @ifdef DEBUG

  if (!lights) return tint(segment.shades, worn, 0.5);
  // @endif

  return litFill(ctx, segment, lightAngle - rotation, (along) =>
    tint(segment.shades, worn, along),
  );
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
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.2;

  if (cache.scale !== game.scale) {
    if (cache.image && 'close' in cache.image) cache.image.close();
    // Keep the blurred bay's actual bounds; most of the old square was empty.
    const left = Math.min(...cache.map(([x]) => x)) * game.scale - glowBlur * 2;
    const top =
      Math.min(...cache.map(([, y]) => y)) * game.scale - glowBlur * 2;
    const right =
      Math.max(...cache.map(([x]) => x)) * game.scale + glowBlur * 2;
    const bottom =
      Math.max(...cache.map(([, y]) => y)) * game.scale + glowBlur * 2;
    const image = document.createElement('canvas');
    const paint = image.getContext('2d')!;

    image.width = Math.ceil(right - left);
    image.height = Math.ceil(bottom - top);
    paint.translate(-left, -top);
    paint.scale(game.scale, game.scale);
    paint.shadowBlur = glowBlur;
    paint.shadowColor = paint.fillStyle = color;
    paint.fill(path);
    cache.image = image;
    cache.scale = game.scale;
    cache.left = left / game.scale;
    cache.top = top / game.scale;

    createImageBitmap(image)
      .then((bitmap) => {
        if (cache.image === image) {
          cache.image = bitmap;
        } else {
          bitmap.close();
        }
      })
      .catch(() => {});
  }

  ctx.drawImage(
    cache.image!,
    cache.left!,
    cache.top!,
    cache.image!.width / game.scale,
    cache.image!.height / game.scale,
  );

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
export const drawBeam = ({
  ctx,
  path,
  color,
  reach,
  spread,
  activationProgress,
  lit,
}: {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  color: string;
  reach: number;
  spread: number;
  activationProgress: number;
  lit: Path2D;
}) => {
  // @ifdef DEBUG
  if (!lights) return;
  // @endif
  // @ifdef BENCHMARK

  if (benchmarkFlag('noLighting') || benchmarkFlag('noBeam')) return;
  // @endif

  let cached = beamImages.get(path);
  const scale = game.scale;
  const padding = glowBlur * 2;

  if (!cached || cached.scale !== scale) {
    cached?.images.forEach((image) => {
      if ('close' in image) image.close();
    });

    cached = { images: new Map(), scale };
    beamImages.set(path, cached);
  }

  let image = cached.images.get(color);

  if (!image) {
    const canvas = document.createElement('canvas');
    const paint = canvas.getContext('2d')!;

    canvas.width = Math.ceil(reach * scale + padding * 2);
    canvas.height = Math.ceil(spread * 2 * scale + padding * 2);
    paint.translate(padding, spread * scale + padding);
    paint.scale(scale, scale);
    const gradient = paint.createLinearGradient(0, 0, reach, 0);

    gradient.addColorStop(0, color);
    gradient.addColorStop(0.15, withAlpha({ color, alpha: 0.8 }));
    gradient.addColorStop(1, withAlpha({ color: '#000', alpha: 0 }));

    // Bake the same screen-pixel blur once. The traced rock edge still clips
    // both the cone and its glow when the cached image is drawn each frame.
    // @ifdef BENCHMARK
    if (!benchmarkFlag('noBlur')) {
      // @endif
      paint.shadowBlur = glowBlur;
      paint.shadowColor = color;
      // @ifdef BENCHMARK
    }

    // @endif
    paint.fillStyle = gradient;
    paint.fill(path);
    cached.images.set(color, canvas);
    image = canvas;
    const entry = cached;

    createImageBitmap(canvas)
      .then((bitmap) => {
        if (beamImages.get(path) === entry) {
          entry.images.set(color, bitmap);
        } else {
          bitmap.close();
        }
      })
      .catch(() => {});
  }

  ctx.save();
  // The cone says how wide the beam is and the trace says how far it got, so
  // one is filled through the other
  ctx.clip(lit);
  ctx.globalAlpha = activationProgress * 0.5;

  ctx.drawImage(
    image,
    -padding / scale,
    -spread - padding / scale,
    image.width / scale,
    image.height / scale,
  );
  ctx.restore();
};

// Both local and remote beams reveal the contents of rock they cross.
export const revealBuriedItems = ({
  sprites,
  scenery = sprites,
  predicted,
  poses,
}: {
  sprites: GameObject[];
  scenery?: GameObject[];
  predicted: ReadonlyMap<number, GameObject>;
  poses: ReadonlyMap<number, Pose>;
}) => {
  const asteroids = sprites.filter(
    (sprite) => sprite.scenery && sprite.segments && sprite.renderContents,
  );

  if (!asteroids.length) return;

  const { ctx, scale } = game;

  sprites.forEach((sprite) => {
    if (!(sprite instanceof Craft) || sprite.dead || sprite.decay) return;
    const prediction = predicted.get(sprite.id);
    const craft = prediction instanceof Craft ? prediction : sprite;
    const pose = poses.get(sprite.id) || craft;

    craft.segments.forEach((lamp) => {
      if (
        !(lamp.beam ?? lamp.module.beam) ||
        lamp.activationProgress <= 0.5 ||
        (lamp.mount || lamp).health < 1
      ) {
        return;
      }

      const beam = lamp.prism || traceBeam(pose, lamp, scenery);
      const bounds = insideBounds(beam);

      const items = asteroids
        .filter((asteroid) => !beam.objects || beam.objects.includes(asteroid))
        .flatMap((asteroid) => asteroid.renderContents as GameObject[])
        .filter((item) => {
          if (!item.position || !item.radius) return true;
          const at = Vec.subtract(
            rotatePoint(
              Vec.subtract(item.position, pose.position),
              -pose.rotation,
            ),
            lamp.localPosition,
          );
          // Include strokes and glints, which can extend past an item's body.
          const radius = item.radius * 2 + 2 + 1 / scale;

          return (
            at.x + radius >= bounds.left &&
            at.x - radius <= bounds.right &&
            at.y + radius >= bounds.top &&
            at.y - radius <= bounds.bottom
          );
        });

      if (!items.length) return;

      // Nested, changing clips can trigger expensive GPU work on first use.
      // Rasterize only this small slice of revealed cargo, then composite it.
      revealSurface ||= document.createElement('canvas');

      const paint = revealSurface.getContext('2d', {
        willReadFrequently: true,
      })!;

      const left = Math.floor(bounds.left * scale - 1) / scale;
      const top = Math.floor(bounds.top * scale - 1) / scale;
      const width = Math.ceil(bounds.right * scale + 1) - left * scale;
      const height = Math.ceil(bounds.bottom * scale + 1) - top * scale;

      // Reuse the backing store as the beam changes shape and direction.
      if (width > revealSurface.width) {
        revealSurface.width = Math.ceil(width / 64) * 64;
      }

      if (height > revealSurface.height) {
        revealSurface.height = Math.ceil(height / 64) * 64;
      }

      paint.resetTransform();
      // Only the used rectangle is copied below. Clear a pixel of transparent
      // guard space too, so interpolation cannot pick up an older beam's edge.
      paint.clearRect(0, 0, Math.ceil(width) + 1, Math.ceil(height) + 1);
      paint.save();
      paint.translate(-left * scale, -top * scale);
      paint.scale(scale, scale);
      paint.clip(insidePath(beam));
      paint.clip(beam.mask);
      paint.translate(-lamp.localPosition.x, -lamp.localPosition.y);
      paint.rotate(-pose.rotation);
      paint.translate(-pose.position.x, -pose.position.y);
      items.forEach((item) => item.render({ ctx: paint }));
      paint.restore();

      ctx.save();
      ctx.translate(pose.position.x, pose.position.y);
      ctx.rotate(pose.rotation);
      ctx.translate(lamp.localPosition.x, lamp.localPosition.y);
      ctx.drawImage(
        revealSurface,
        0,
        0,
        width,
        height,
        left,
        top,
        width / scale,
        height / scale,
      );
      ctx.restore();
    });
  });
};
