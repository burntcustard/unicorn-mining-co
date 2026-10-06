import { game } from '../../game';
import { shapePath } from '../../utilities/drawing';
import { drawBeam } from '../../utilities/lighting';
import { traceBeam, litPath } from '../../utilities/prism';
import { Module, type ModuleRenderOptions } from './module';
import { type ModuleSpec } from '../../../specs/modules/types';

// SearchLight
// A lamp slung under the nose that throws a cone of light out ahead of the
// ship. It sits below the hull so that what it falls on is whatever the ship
// is flying over, with the hull itself sat dark on top of it.

class SearchLightModule extends Module {
  static createModel(spec: Extract<ModuleSpec, { behavior: 'searchLight' }>) {
    const { lens, reach, mouth, spread, corner } = spec;
    const far = lens + reach;

    return [
      {
        wreckage: {
          // The lamp housing is half the length of a cargo-hatch door.
          points: [
            [lens, -1.5],
            [lens + 8, -1.5],
            [lens + 8, 1.5],
            [lens, 1.5],
          ],
          fillShade: 2,
        },
        points: ({ activationProgress }: { activationProgress: number }) =>
          activationProgress
            ? [
                [lens, -mouth],
                [far - corner, -spread],
                [far, corner - spread],
                [far, spread - corner],
                [far - corner, spread],
                [lens, mouth],
              ]
            : [],
      },
    ];
  }

  render({ segment, craft, scenery, pose = craft }: ModuleRenderOptions) {
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
