import type { GameObject } from '../../client/objects/game-object';
import { circlePath, shapePath } from '../../client/utilities/drawing';
import { withAlpha } from '../../client/utilities/color';

/*
 * Colliders already carry their world pose and local outline. Draw those exact
 * fixtures, including animated and nonphysical pieces in a stationary preview.
 */
export const drawHitboxes = ({
  ctx,
  object,
  scale,
}: {
  ctx: CanvasRenderingContext2D;
  object: GameObject;
  scale: number;
}) => {
  ctx.save();
  ctx.fillStyle = withAlpha({ color: '#f00', alpha: 0.1 });
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 1.5 / scale;

  for (const collider of object.hitbox()) {
    const path = collider.shapeOutline?.length
      ? shapePath(collider.shapeOutline)
      : circlePath(collider.radius);

    ctx.save();
    ctx.translate(collider.position.x, collider.position.y);
    ctx.rotate(collider.rotation);
    ctx.fill(path);
    ctx.stroke(path);
    ctx.restore();
  }

  ctx.restore();
};
