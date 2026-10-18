import { targetKinds } from './target-kinds';
import { type GameObject } from '../objects/game-object';
import { type Pose } from '../types';
import { type GameState } from '../game';
import * as Vec from '../utilities/vector';
import { camera } from '../camera';
import { colors } from '../../specs/colors';
import { pathOutline } from './path-outline';
import { renderText } from './text';

type Bounds = { left: number; right: number; top: number; bottom: number };

type TargetView = { object: GameObject; bounds: Bounds; distance: number };

/**
 * Bound target candidates around the rendered pose using object radius.
 */
export const targetBounds = (object: GameObject, pose: Pose): Bounds => ({
  left: pose.position.x - object.radius,
  right: pose.position.x + object.radius,
  top: pose.position.y - object.radius,
  bottom: pose.position.y + object.radius,
});

export class Targeting {
  private candidates: TargetView[] = [];
  private targetId?: number;
  private pointer?: Vec.Value;
  private targetView?: TargetView;
  private hovered?: TargetView;

  clear() {
    this.pointer = undefined;
    this.targetId = undefined;
    this.targetView = undefined;
    this.hovered = undefined;
  }

  hover(pointer?: Vec.Value) {
    this.pointer = pointer;
    this.updateHover();
  }

  targetHovered() {
    this.targetView = this.hovered;
    this.targetId = this.targetView?.object.id;
  }

  cycleTarget(reverse = false) {
    const ordered = this.candidates.toSorted(
      (a, b) => a.distance - b.distance || a.object.id - b.object.id,
    );
    const index = ordered.findIndex(
      ({ object }) => object.id === this.targetId,
    );
    const next =
      index < 0
        ? reverse
          ? ordered.length - 1
          : 0
        : (index + (reverse ? -1 : 1) + ordered.length) % ordered.length;

    this.targetView = ordered[next];
    this.targetId = this.targetView?.object.id;
  }

  update({
    game,
    objects,
    poses,
    ship,
  }: {
    game: GameState;
    objects: GameObject[];
    poses: Map<number, Pose>;
    ship: GameObject;
  }) {
    const shipPosition = poses.get(ship.id)?.position || ship.position;

    this.candidates = objects
      .filter(
        (object) =>
          object !== ship &&
          object.id !== ship.id &&
          !object.dead &&
          !object.buried &&
          targetKinds.has(object.kind!),
      )
      .map((object) => {
        const pose = poses.get(object.id) || object;

        return {
          object,
          bounds: targetBounds(object, pose),
          distance: Vec.distanceSquared(pose.position, shipPosition),
        };
      })
      .filter(
        ({ bounds }) =>
          bounds.right >= camera.x &&
          bounds.left <= camera.x + game.width &&
          bounds.bottom >= camera.y &&
          bounds.top <= camera.y + game.height,
      );

    this.targetView = this.candidates.find(
      ({ object }) => object.id === this.targetId,
    );

    if (!this.targetView) this.targetId = undefined;
    this.updateHover();
  }

  private updateHover() {
    const pointer = this.pointer;

    this.hovered =
      pointer &&
      this.candidates
        .filter(
          ({ bounds }) =>
            pointer.x >= bounds.left &&
            pointer.x <= bounds.right &&
            pointer.y >= bounds.top &&
            pointer.y <= bounds.bottom,
        )
        .toSorted(
          (a, b) =>
            (a.bounds.right - a.bounds.left) *
              (a.bounds.bottom - a.bounds.top) -
              (b.bounds.right - b.bounds.left) *
                (b.bounds.bottom - b.bounds.top) || a.distance - b.distance,
        )[0];
  }

  get target() {
    return this.targetView?.object;
  }

  get hoveredObject() {
    return this.hovered?.object;
  }

  render(game: GameState) {
    if (this.hovered && this.hovered.object.id !== this.targetId) {
      this.renderIndicator({ game, view: this.hovered, targeted: false });
    }

    if (this.targetView) {
      this.renderIndicator({ game, view: this.targetView, targeted: true });
    }
  }

  private renderIndicator({
    game,
    view,
    targeted,
  }: {
    game: GameState;
    view: TargetView;
    targeted: boolean;
  }) {
    const { object, bounds } = view;
    const ratio = game.scale / game.uiScale;
    const center = Vec.create(
      ((bounds.left + bounds.right) / 2 - camera.x) * ratio,
      ((bounds.top + bounds.bottom) / 2 - camera.y) * ratio,
    );
    const radius = object.radius * ratio;
    // The hexagon's sides clear the object's radius, including UI padding.
    const reach = ((radius + 5) * 2) / Math.sqrt(3);
    // Corner lengths grow smoothly with radius, without a minimum length.
    const corner = Math.sqrt(radius) / reach;

    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = (index * Math.PI) / 3;

      return Vec.create(
        center.x + Math.cos(angle) * reach,
        center.y + Math.sin(angle) * reach,
      );
    });

    const path = new Path2D();

    points.forEach((point, index) => {
      const start = Vec.addScaled(
        point,
        Vec.subtract(points[(index + 5) % 6], point),
        corner,
      );
      const end = Vec.addScaled(
        point,
        Vec.subtract(points[(index + 1) % 6], point),
        corner,
      );

      path.moveTo(start.x, start.y);
      path.lineTo(point.x, point.y);
      path.lineTo(end.x, end.y);
    });

    const { ctx } = game;

    ctx.save();
    ctx.globalAlpha *= targeted ? 0.9 : 0.5;
    ctx.scale(game.uiScale, game.uiScale);
    ctx.strokeStyle = colors.violet[2];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'bevel';
    pathOutline({ ctx, path });
    ctx.stroke(path);
    ctx.restore();

    if (!targeted) return;

    (object.targetLabel || object.name).split('\n').forEach((text, index) => {
      renderText({
        game,
        text,
        x: center.x,
        y: center.y + radius + 10 + index * 12,
        align: 0,
        color: colors.violet[2],
      });
    });
  }
}
