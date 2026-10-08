import { game } from '../../game';
import { shapePath } from '../../utilities/drawing';
import { drawBeam } from '../../utilities/lighting';
import { traceBeam, litPath } from '../../utilities/prism';
import { Module, type ModuleRenderOptions } from './module';
import { type ModuleSpec } from '../../../specs/modules/types';

// SearchLight
// A lamp on the nose, with its housing and beam below the hull and horn drill.

class SearchLightModule extends Module {
  static createModel(spec: Extract<ModuleSpec, { behavior: 'searchLight' }>) {
    const { reach, spread, corner } = spec;

    return [
      {
        wreckage: false,
        points: ({ activationProgress }: { activationProgress: number }) =>
          activationProgress
            ? [
                [0, 0],
                [reach - corner, -spread],
                [reach, corner - spread],
                [reach, spread - corner],
                [reach - corner, spread],
              ]
            : [],
      },
      ...super.createModel(spec).map((part) => ({
        ...part,
        beam: false,
        wreckage: { color: part.color, fillShade: part.fillShade },
      })),
    ];
  }

  render({ segment, craft, scenery, pose = craft }: ModuleRenderOptions) {
    if (segment.beam === false) {
      super.render({ segment });
      return;
    }

    if (!segment.activationProgress) return;
    const beam = segment.prism || traceBeam(pose, segment, scenery);

    super.render({
      segment,
      draw: () =>
        drawBeam(
          game.ctx,
          shapePath(
            typeof segment.points === 'function'
              ? segment.points(segment)
              : segment.points,
          ),
          segment.shades[2],
          this.reach,
          segment.activationProgress,
          litPath(beam),
        ),
    });
  }
}

export const SearchLight = SearchLightModule.define('searchLight');
