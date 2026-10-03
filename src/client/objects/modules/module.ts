import { game } from '../../game';
import { circlePath, shapePath, linesPath } from '../../utilities/drawing';
import { GameObject } from '../game-object';

import { type Craft } from '../craft';
import { type Pose, type Segment, type ShapeOutline } from '../../types';

export interface ModuleRenderOptions {
  segment: Segment;
  points?: ShapeOutline;
  draw?: () => void;
  craft?: Craft;
  scenery?: GameObject[];
  pose?: Pose;
}

export class Module extends GameObject {
  static [key: string]: any;
  declare health: number;
  declare label: string;
  static model: any[] = [];
  declare model: any[];
  declare mount: any;

  render({ segment, points, draw }: ModuleRenderOptions) {
    super.render({
      draw: () => {
        if (draw) {
          draw();
          return;
        }

        const { ctx } = game;
        const shapeOutline =
          points ??
          (typeof segment.points === 'function'
            ? segment.points(segment)
            : segment.points);
        const shape = shapeOutline?.length
          ? shapePath(shapeOutline, segment.unclosed)
          : segment.radius
            ? circlePath(segment.radius(segment))
            : undefined;

        if (!shape) return;
        const shades = this.shades || segment.shades;

        // Modules default to their darkest shade, a step below the hull's.
        ctx.fillStyle = segment.fillAlpha
          ? shades[2] + segment.fillAlpha
          : shades[segment.fillShade ?? 0];
        ctx.strokeStyle = shades[2];
        ctx.fill(shape);
        ctx.stroke(
          segment.shapeOutline ? linesPath(segment.shapeOutline) : shape,
        );
      },
    });
  }
}
