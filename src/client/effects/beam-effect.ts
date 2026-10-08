import { withAlpha } from '../utilities/color';

export type BeamMarkerLayer = {
  radius: number;
  alpha?: number;
} & (
  | {
      type: 'rays';
      pointCount: number;
      radiusEven: number;
      lineWidth: number;
    }
  | {
      type: 'glow';
    }
);

export type BeamEffectSpec = {
  startFraction: number;
  muzzleOffset: number;
  pulseDuration: number;
  pulseScale: number;
  layers: readonly {
    lineWidth: number;
    alpha: number;
  }[];
  muzzleFlash: readonly BeamMarkerLayer[];
  hitMarker: readonly BeamMarkerLayer[];
};

/**
 * Render a continuous painted beam, with its cap between the beam and flares.
 * Elapsed time and pulse duration use milliseconds.
 */
export const renderBeamEffect = ({
  ctx,
  effect,
  color,
  barrelLength,
  end,
  hit,
  elapsed,
  draw,
}: {
  ctx: CanvasRenderingContext2D;
  effect: BeamEffectSpec;
  color: string;
  barrelLength: number;
  end: number;
  hit: boolean;
  elapsed: number;
  draw: () => void;
}) => {
  const pulse =
    1 +
    effect.pulseScale *
      Math.sin((elapsed * Math.PI * 2) / effect.pulseDuration);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const layer of effect.layers) {
    ctx.strokeStyle = withAlpha({ color, alpha: layer.alpha });
    ctx.lineWidth = layer.lineWidth * pulse;
    ctx.beginPath();
    ctx.moveTo(barrelLength * effect.startFraction, 0);
    ctx.lineTo(end, 0);
    ctx.stroke();
  }

  ctx.restore();
  draw();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const [x, layers] of [
    [barrelLength + effect.muzzleOffset, effect.muzzleFlash] as const,
    ...(hit ? [[end, effect.hitMarker] as const] : []),
  ]) {
    for (const layer of layers) {
      if (layer.type === 'rays') {
        ctx.strokeStyle = withAlpha({ color, alpha: layer.alpha ?? 1 });
        ctx.lineWidth = layer.lineWidth;
        ctx.beginPath();

        for (let i = 0; i < layer.pointCount; i++) {
          const angle = (i * Math.PI * 2) / layer.pointCount;
          const radius = (i % 2 ? layer.radiusEven : layer.radius) * pulse;

          ctx.moveTo(x, 0);
          ctx.lineTo(x + Math.cos(angle) * radius, Math.sin(angle) * radius);
        }

        ctx.stroke();
      } else {
        const glow = ctx.createRadialGradient(x, 0, 0, x, 0, layer.radius);

        glow.addColorStop(0, withAlpha({ color, alpha: layer.alpha ?? 1 }));
        glow.addColorStop(1, withAlpha({ color, alpha: 0 }));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, 0, layer.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
};
