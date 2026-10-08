import { moduleSpecForSimulation } from '../../utilities/module-spec';
import { withAlpha } from '../../utilities/color';
import { game } from '../../game';
import { circlePath, shapePath, linesPath } from '../../utilities/drawing';
import { GameObject } from '../game-object';
import {
  moduleSpecList,
  moduleIds,
  type ModuleId,
} from '../../../specs/modules';
import { type ModuleSpec } from '../../../specs/modules/types';

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
  static definitionId: ModuleId;
  declare health: number;
  declare name: string;
  static model: any[] = [];
  declare model: any[];
  declare mount: any;

  static define<T extends typeof Module>(this: T, id: ModuleId): T {
    // Use the wire-ordered catalog; spec object keys are mangled separately.
    const spec = moduleSpecForSimulation(moduleSpecList[moduleIds.indexOf(id)]);

    class DefinedModule extends (this as typeof Module) {
      static definitionId = id;
      static name = spec.name;
    }

    return Object.assign(DefinedModule, spec, {
      model: this.createModel(spec),
    }) as unknown as T;
  }

  static createModel(spec: ModuleSpec): any[] {
    return spec.model.map((part) => ({
      ...part,
      fillShade: part.color,
      shapeOutline: part.outline === false ? ([] as ShapeOutline) : undefined,
    }));
  }

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
        const shades = this.modelShades || this.shades || segment.shades;

        // Modules default to their darkest shade, a step below the hull's.
        ctx.fillStyle =
          segment.fillAlpha !== undefined
            ? withAlpha({ color: shades[2], alpha: segment.fillAlpha })
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
