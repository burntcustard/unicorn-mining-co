import { Craft } from '../../shared/craft/craft';
import { Module } from '../../shared/modules/module';
import { giveRender } from '../give-render';
import '../game-object';
import '../modules/module';
import '../modules/horn-drill';
import '../modules/cargo-hatch';
import '../modules/search-light';
import '../modules/shield-generator';
import '../modules/thruster';
import { drawThrusterGlow } from '../lighting';
import { drawInside, drawSpectrum, traceBeam } from '../prism';
import { objectLineWidth } from '../drawing';
import { renderWreckage } from './wreckage';
import { game } from '../game';
import { type Segment } from '../../shared/types';

// @ifdef DEBUG
import { lights } from '../lighting';

// @endif

giveRender({
  Type: Craft,
  render(
    this: Craft,
    {
      scenery = [],
      zIndex = 0,
      draw,
      drawHull = renderWreckage,
      parent,
      pose = this,
    },
  ) {
    const { ctx } = game;
    // Only the shared thruster-glow layer has a fractional z-index.
    const glow = zIndex % 1;

    parent({
      pose,
      draw: () => {
        ctx.lineJoin = 'bevel';
        ctx.lineWidth = objectLineWidth;

        // @ifdef DEBUG
        if (lights || glow) {
          // @endif
          if (zIndex === -3 || zIndex === -1 || glow) {
            this.segments.forEach((segment: Segment) => {
              if (
                !(glow ? segment.module.forwardThrust : segment.module.beam) ||
                !segment.activationProgress ||
                (segment.mount || segment).health < 1
              ) {
                return;
              }

              ctx.save();
              ctx.translate(segment.localPosition.x, segment.localPosition.y);

              if (zIndex === -3) {
                segment.prism = traceBeam(pose, segment, scenery);
              }

              (glow
                ? drawThrusterGlow
                : zIndex === -3
                  ? drawSpectrum
                  : drawInside)(ctx, segment, segment.prism);

              ctx.restore();
            });
          }
          // @ifdef DEBUG
        }
        // @endif

        draw?.();

        this.segments.forEach((segment: Segment) => {
          const health = (segment.mount || segment).health;

          if (segment.zIndex !== zIndex || health < 1) return;

          ctx.save();
          ctx.translate(segment.localPosition.x, segment.localPosition.y);

          segment.shades ||= segment.module.shades || this.shades;

          if (segment.module instanceof Module) {
            segment.module.render({ segment, craft: this, scenery, pose });
          } else drawHull({ segment, health });

          ctx.restore();
        });
      },
    });
  },
  updateVisual(dt: number) {
    this.modules.forEach((module: Module) =>
      module.updateVisual?.({
        dt,
        segments: this.segmentsAtMount(module.mount),
      }),
    );
  },
});
