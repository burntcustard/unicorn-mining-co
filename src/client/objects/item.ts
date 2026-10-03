import { colors } from '../../definitions/colors';
import { game } from '../game';
import {
  circlePath,
  itemLineWidth,
  linesPath,
  shapePath,
  sparklePath,
} from '../utilities/drawing';
import { GameObject, type RenderOptions } from './game-object';
import { radiusOf } from '../utilities/polygon';
import { type Collider } from '../collision/types';
import { cargoPickupPoint } from './modules/cargo-hatch';
import { itemDefaults } from '../../definitions/items/defaults';
import type { ItemDefinition } from '../../definitions/items/types';

export class Item extends GameObject {
  kind = 'item' as const;
  declare resource: number;

  addToScene() {
    this.networked = 1;
    this.fill = this.shades[1];
    this.stroke = this.shades[2];
    return super.addToScene();
  }

  constructor(
    definition: ItemDefinition,
    properties: ConstructorParameters<typeof GameObject>[0] = {},
  ) {
    super({ ...itemDefaults, ...definition, ...properties });
    this.item = definition;
    this.shapeOutline = this.points;

    if (this.shapeOutline) this.radius = radiusOf(this.shapeOutline);
  }

  hitbox(): Collider[] {
    const body = super.hitbox();

    return body.length ? [...body, cargoPickupPoint(this)] : body;
  }

  render({ pose = this }: RenderOptions = {}) {
    super.render({
      pose,
      draw: () => {
        const { ctx } = game;
        const path = this.points
          ? shapePath(this.points)
          : circlePath(this.radius);

        ctx.lineJoin = 'bevel';
        ctx.lineWidth = itemLineWidth;
        ctx.strokeStyle = this.shades[2];
        ctx.fillStyle = this.shades[1] + (this.fillAlpha || '');

        if (this.rainbow) {
          const rainbow = ctx.createLinearGradient(
            -this.radius,
            0,
            this.radius,
            0,
          );

          rainbow.addColorStop(0, colors.violet[2]);
          rainbow.addColorStop(0.5, colors.yellow[2]);
          rainbow.addColorStop(1, colors.cyan[2]);
          ctx.fillStyle = rainbow;
        }

        ctx.fill(path);
        ctx.stroke(path);

        if (this.lines) ctx.stroke(linesPath(this.lines));

        if (this.glint) {
          ctx.translate(this.radius * 0.3, this.radius * -0.28);
          ctx.rotate(-pose.rotation);
          ctx.fillStyle = colors.white[2];
          ctx.fill(sparklePath(this.radius * 0.3));
        }
      },
    });
  }
}
