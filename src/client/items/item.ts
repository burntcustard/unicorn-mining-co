import { Item } from '../../shared/items/item';
import { colors } from '../../shared/colors';
import { game } from '../game';
import { giveRender } from '../give-render';
import {
  circlePath,
  itemLineWidth,
  linesPath,
  shapePath,
  sparklePath,
} from '../drawing';
import '../game-object';

giveRender({
  Type: Item,
  render(this: Item, { parent, pose = this }) {
    parent({
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
  },
});
