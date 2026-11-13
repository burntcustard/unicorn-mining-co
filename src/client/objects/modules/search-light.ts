import { game } from '../../game';
import { shapePath } from '../../utilities/drawing';
import { drawBeam } from '../../utilities/lighting';
import { traceBeam, litPath, filteredPaths } from '../../utilities/prism';
import { Module, type ModuleRenderOptions } from './module';
import { type ModuleSpec } from '../../../specs/modules/types';

// SearchLight
// A lamp on the nose, with its housing and beam below the hull and horn drill.
const paths = new WeakMap<object, { outline: number[][]; path: Path2D }>();

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
    const beam = segment.prism || traceBeam(pose, segment, scenery, craft);
    const points = segment.points;
    const outline = typeof points === 'function' ? points(segment) : points;
    let cached = paths.get(points);

    if (
      !cached ||
      cached.outline.length !== outline.length ||
      outline.some(
        ([x, y], index) =>
          cached.outline[index][0] !== x || cached.outline[index][1] !== y,
      )
    ) {
      cached = {
        outline: outline.map(([x, y]) => [x, y]),
        path: shapePath(outline),
      };

      paths.set(points, cached);
    }

    super.render({
      segment,
      draw: () => {
        const options = {
          ctx: game.ctx,
          path: cached.path,
          reach: this.reach,
          spread: this.spread,
          activationProgress: segment.activationProgress,
        };

        drawBeam({
          ...options,
          color: segment.shades[2],
          lit: litPath(beam),
        });

        filteredPaths(beam).forEach((lit, color) => {
          drawBeam({ ...options, color, lit });
        });
      },
    });
  }
}

export const SearchLight = SearchLightModule.define('searchLight');
