import {
  drawBeam,
  drawDockingBayGlow,
  drawThrusterGlow,
  lightAngle,
  litFill,
  tint,
} from './lighting';
import { drawInside, drawSpectrum, litPath, traceBeam } from './prism';
import { linesPath, objectLineWidth } from './drawing';
import { colors } from './colors';

// @ifdef DEBUG
// eslint-disable-next-line no-duplicate-imports -- lights only exists in DEBUG builds
import { lights } from './lighting';
// @endif

export const active = (health) => !(health < 1);
export const healthOf = (segment) =>
  segment.mount?.health ?? segment.mount?.hull?.health ?? segment.health;

export const renderCraft = (craft, scenery, zIndex) => {
  const { ctx } = craft;

  ctx.save();
  ctx.translate(craft.x, craft.y);
  ctx.rotate(craft.rotation);
  ctx.lineJoin = 'bevel';
  ctx.lineWidth = objectLineWidth;

  // @ifdef DEBUG
  if (lights) {
  // @endif
    if (zIndex === -3 || zIndex === -1) {
      craft.segments.forEach((segment) => {
        if (!segment.module.beam || !segment.activationProgress || !active(healthOf(segment))) return;

        ctx.save();
        ctx.translate(segment.x, segment.y);

        if (zIndex === -3) {
          const beam = segment.prism = traceBeam(craft, segment, scenery || []);

          drawSpectrum(ctx, segment, beam);
        } else {
          drawInside(ctx, segment, segment.prism);
        }

        ctx.restore();
      });
    }
  // @ifdef DEBUG
  }
  // @endif

  if (zIndex === -3 && craft.localMovementRadius) {
    ctx.strokeStyle = `${colors.cyan[2]}4`;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, craft.localMovementRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const light = lightAngle - craft.rotation;

  craft.segments.forEach((segment) => {
    const health = healthOf(segment);

    if (segment.zIndex !== zIndex || !active(health)) return;

    ctx.save();
    ctx.translate(segment.x, segment.y);

    if (segment.forwardThrust && segment.activationProgress) {
      drawThrusterGlow(ctx, segment);
    }

    if (segment.glow && zIndex < 0) {
      drawDockingBayGlow(ctx, segment.glow.path, segment.shades[2], segment.glow);
    }

    const worn = health < segment.module.health / 2 ? 0 : 1 + segment.hull;
    let lit;

    if (segment.middle) {
      // @ifdef DEBUG
      if (!lights) {
        lit = tint(segment.shades, worn, 0.5);
      } else {
      // @endif
        lit = litFill(ctx, segment, light,
          (along) => tint(segment.shades, worn, along));
      // @ifdef DEBUG
      }
      // @endif
    }

    ctx.fillStyle = segment.fillAlpha ?
      segment.shades[2] + segment.fillAlpha :
      lit || segment.shades[worn];
    ctx.strokeStyle = segment.shades[2];

    const path = segment.path?.(segment);

    if (path) {
      if (segment.module.beam) {
        // @ifdef DEBUG
        if (lights) {
        // @endif
          const beam = segment.prism || traceBeam(craft, segment, scenery || []);

          drawBeam(ctx, path, segment.shades[2], segment.module.reach,
            segment.activationProgress, litPath(beam));
        // @ifdef DEBUG
        }
        // @endif
      } else {
        ctx.fill(path);
        ctx.stroke(segment.outline ? linesPath(segment.outline) : path);
      }
    }

    if (segment.lines) {
      ctx.save();
      if (segment.lines.call) ctx.clip(path);
      ctx.stroke(linesPath(segment.lines.call ? segment.lines(segment) : segment.lines));
      ctx.restore();
    }

    if (segment.glow && zIndex >= 0) {
      drawDockingBayGlow(ctx, segment.glow.path, segment.shades[2], segment.glow);
    }

    ctx.restore();
  });

  ctx.restore();
};
