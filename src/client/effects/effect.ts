import { withAlpha } from '../utilities/color';
import { createPolygon } from '../utilities/polygon';
import { shapePath, objectLineWidth } from '../utilities/drawing';
import * as Vec from '../utilities/vector';

// All timing is in milliseconds. Scale interpolates over the whole layer.
export type EffectLayer = {
  alpha?: number;
  color: string;
  delay?: number;
  duration: number;
  // Easing exponent; omitted means linear, 2 means quadratic.
  easeOut?: number;
  fadeDuration?: number;
  radius: number;
  scale?: readonly [number, number];
} & (
  | {
      dissolveDuration?: number;
      pointCount: number;
      radiusEven?: number | readonly [number, number];
      type: 'polygon';
    }
  | { endLineWidth?: number; lineWidth?: number; type: 'ring' }
  | { type: 'glow' }
);

export type EffectSpec = readonly EffectLayer[];

type PolygonGeometry = {
  path: Path2D;
  points: ReturnType<typeof createPolygon>;
};

type Effect = {
  age: number;
  duration: number;
  parts: (
    | Exclude<EffectLayer, { type: 'polygon' }>
    | (Extract<EffectLayer, { type: 'polygon' }> & PolygonGeometry)
  )[];
  position: Vec.Value;
  rotation: number;
  scale: number;
};

export const effects: Effect[] = [];

const polygonPath = ({
  points,
  radiusEven,
}: {
  points: PolygonGeometry['points'];
  radiusEven: number;
}) =>
  shapePath(
    points.map(([x, y], index) => {
      const scale = index % 2 ? 1 : radiusEven;

      return [x * scale, y * scale];
    }),
  );

export const addEffect = ({
  effect,
  position,
  rotation = Math.random() * Math.PI * 2,
  scale = 1,
}: {
  effect: EffectSpec;
  position: Vec.Value;
  rotation?: number;
  scale?: number;
}) => {
  const shapes = new Map<string, PolygonGeometry>();

  effects.push({
    age: 0,
    duration: Math.max(
      0,
      ...effect.map((part) => (part.delay ?? 0) + part.duration),
    ),
    parts: effect.map((part) => {
      if (part.type !== 'polygon') return part;
      const corners = part.radiusEven ?? part.radius / 4;
      const radiusEven =
        (typeof corners === 'number' ? corners : corners[0]) /
        (part.radius || 1);
      const key = `${part.pointCount}:${radiusEven}`;
      let geometry = shapes.get(key);

      if (!geometry) {
        const points = createPolygon({
          pointCount: part.pointCount * 2,
          radius: 1,
          random: Math.random,
          variance: 0.2,
        });

        geometry = { path: polygonPath({ points, radiusEven }), points };
        shapes.set(key, geometry);
      }

      return { ...part, ...geometry };
    }),
    position: Vec.clone(position),
    rotation,
    scale,
  });
};

/**
 * Advance visual effect timing by elapsed milliseconds.
 */
export const updateEffects = (elapsed: number) => {
  for (let index = effects.length; index--;) {
    const effect = effects[index];

    effect.age += elapsed;

    if (effect.age >= effect.duration) effects.splice(index, 1);
  }
};

export const renderEffects = (ctx: CanvasRenderingContext2D) => {
  for (const effect of effects) {
    ctx.save();
    ctx.translate(effect.position.x, effect.position.y);
    ctx.rotate(effect.rotation);
    ctx.scale(effect.scale, effect.scale);

    for (const part of effect.parts) {
      const age = effect.age - (part.delay ?? 0);

      if (age < 0 || age >= part.duration) continue;
      const progress = age / part.duration;
      const eased = part.easeOut
        ? 1 - (1 - progress) ** part.easeOut
        : progress;
      const [start, end] = part.scale ?? [1, 1];
      const radius = part.radius * (start + (end - start) * eased);

      if (radius <= 0) continue;

      ctx.globalAlpha =
        (part.alpha ?? 1) *
        (part.fadeDuration
          ? Math.min(1, (part.duration - age) / part.fadeDuration)
          : 1);

      if (part.type === 'glow') {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);

        gradient.addColorStop(0, part.color);
        gradient.addColorStop(1, withAlpha({ color: '#000', alpha: 0 }));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (part.type === 'ring') {
        const width = part.lineWidth ?? objectLineWidth;
        const lineWidth =
          width + ((part.endLineWidth ?? width) - width) * progress;

        // Canvas ignores a zero line width and would reuse the previous one.
        if (lineWidth <= 0) continue;
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = part.color;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const corners = part.radiusEven;

        const path =
          corners && typeof corners !== 'number'
            ? polygonPath({
                points: part.points,
                radiusEven:
                  (corners[0] + (corners[1] - corners[0]) * eased) /
                  part.radius,
              })
            : part.path;

        ctx.save();
        ctx.scale(radius, radius);
        ctx.fillStyle = part.color;

        if (
          part.dissolveDuration &&
          age > part.duration - part.dissolveDuration
        ) {
          // Reveal the scene through an expanding hole, without erasing it.
          ctx.clip(path);
          ctx.beginPath();
          ctx.arc(
            0,
            0,
            1 - (part.duration - age) / part.dissolveDuration,
            0,
            Math.PI * 2,
          );
          ctx.rect(-1, -1, 2, 2);
          ctx.fill('evenodd');
        } else ctx.fill(path);

        ctx.restore();
      }
    }

    ctx.restore();
  }
};
