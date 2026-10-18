import { replication } from '../../specs/replication';
import { shipOutlines } from './ship-outline';
import { type Ship } from '../objects/ship';
import { colors } from '../../specs/colors';
import { targetKinds } from './target-kinds';
import { withAlpha } from '../utilities/color';
import { type GameObject } from '../objects/game-object';
import { type Pose } from '../types';
import * as Vec from '../utilities/vector';

// Position-only asteroid contacts fill the radar beyond full entity loading.
export const minimapRange = replication.entityUnload;

/**
 * A north-up radar centered on the rendered ship, using the same smoothed poses
 * as the world. Hidden resources and transient effects never become contacts.
 */
export const renderMinimap = ({
  ctx,
  ship,
  objects,
  poses,
  target,
  asteroidPositions,
}: {
  ctx: CanvasRenderingContext2D;
  ship: Ship;
  objects: GameObject[];
  poses: Map<number, Pose>;
  target?: GameObject;
  asteroidPositions?: Vec.Value[];
}) => {
  const center = poses.get(ship.id) || ship;

  ctx.clearRect(0, 0, 300, 300);
  ctx.save();
  ctx.translate(150, 150);
  ctx.beginPath();
  ctx.arc(0, 0, 148, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = withAlpha({ color: '#eef', alpha: 0.12 });
  const displayScale = 300 / (ctx.canvas?.clientWidth || 300);
  const asteroidRadius = 4 * displayScale;
  const iconRadius = 7 * displayScale;
  const iconStrokeWidth = 2 * displayScale;

  ctx.lineWidth = iconStrokeWidth;
  ctx.beginPath();

  [49, 98].forEach((radius) => {
    ctx.moveTo(radius, 0);
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
  });

  ctx.moveTo(-148, 0);
  ctx.lineTo(148, 0);
  ctx.moveTo(0, -148);
  ctx.lineTo(0, 148);
  ctx.stroke();

  const drawAsteroid = (offset: Vec.Value) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(offset.x, offset.y, asteroidRadius, 0, Math.PI * 2);
    ctx.fill();
  };

  asteroidPositions?.forEach((position) => {
    const offset = Vec.scale(
      Vec.subtract(position, center.position),
      148 / minimapRange,
    );

    if (Vec.lengthSquared(offset) <= (148 + asteroidRadius) ** 2) {
      drawAsteroid(offset);
    }
  });

  objects.forEach((object) => {
    if (
      object.id === ship.id ||
      object.dead ||
      object.buried ||
      !targetKinds.has(object.kind!)
    ) {
      return;
    }

    const pose = poses.get(object.id) || object;
    const offset = Vec.scale(
      Vec.subtract(pose.position, center.position),
      148 / minimapRange,
    );

    const markerRadius =
      object.id === target?.id
        ? 14 * displayScale
        : object.kind === 'asteroid' || object.kind === 'item'
          ? asteroidRadius
          : iconRadius + iconStrokeWidth / 2;

    if (Vec.lengthSquared(offset) > (148 + markerRadius) ** 2) return;

    if (
      object.kind === 'asteroid' &&
      asteroidPositions &&
      object.id !== target?.id
    ) {
      return;
    }

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.lineWidth = iconStrokeWidth;
    ctx.lineJoin = 'round';

    if (object.id === target?.id) {
      ctx.strokeStyle = '#e6f';
      ctx.beginPath();

      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;

        ctx.lineTo(
          Math.cos(angle) * 13 * displayScale,
          Math.sin(angle) * 13 * displayScale,
        );
      }

      ctx.closePath();
      ctx.stroke();
    }

    ctx.strokeStyle = object.kind === 'station' ? '#3f7' : '#eef';
    ctx.fillStyle = '#eef';
    ctx.beginPath();

    if (object.kind === 'item') {
      ctx.fillStyle = colors.cyan[2];
      ctx.arc(0, 0, asteroidRadius, 0, Math.PI * 2);
      ctx.fill();
    } else if (object.kind === 'asteroid') {
      if (!asteroidPositions) drawAsteroid(Vec.create());
    } else if (['station', 'jumpGate', 'wormhole'].includes(object.kind!)) {
      const sides =
        object.kind === 'station'
          ? object.definitionId === 'corral-6'
            ? 6
            : 5
          : object.kind === 'jumpGate'
            ? 8
            : 4;

      if (object.kind === 'jumpGate') ctx.strokeStyle = '#fff';

      for (let i = 0; i < sides; i++) {
        const angle = (i * Math.PI * 2) / sides - Math.PI / 2;

        ctx.lineTo(Math.cos(angle) * iconRadius, Math.sin(angle) * iconRadius);
      }

      ctx.closePath();
    } else {
      ctx.rotate(pose.rotation);
      ctx.moveTo(-0.8 * iconRadius, -0.6 * iconRadius);
      ctx.lineTo(iconRadius, 0);
      ctx.lineTo(-0.8 * iconRadius, 0.6 * iconRadius);
      ctx.closePath();
      ctx.fill();
    }

    if (object.kind !== 'asteroid' && object.kind !== 'item') ctx.stroke();

    if (object.kind === 'jumpGate') {
      [
        colors.red,
        colors.orange,
        colors.yellow,
        colors.green,
        colors.cyan,
        colors.violet,
      ].forEach((shades, index) => {
        ctx.beginPath();
        ctx.strokeStyle = shades[2];
        ctx.arc(
          0,
          0,
          iconRadius * 0.45,
          (index * Math.PI) / 3,
          ((index + 1) * Math.PI) / 3,
        );
        ctx.stroke();
      });
    }

    ctx.restore();
  });

  ctx.rotate(center.rotation);
  ctx.fillStyle = colors.white[2];
  ctx.strokeStyle = withAlpha({ color: colors.black[0], alpha: 0.8 });
  ctx.lineJoin = 'round';
  const outlines = shipOutlines({ ship, hullOnly: true });
  const radius = Math.max(
    1,
    ...outlines.flat().map(([x, y]) => Math.hypot(x, y)),
  );

  const scale = (iconRadius * 2) / radius;

  ctx.scale(scale, scale);
  // The white fill covers the inner half; keep the visible outer edge 2px.
  ctx.lineWidth = (iconStrokeWidth * 2) / scale;

  ctx.beginPath();

  outlines.forEach((points) => {
    points.forEach(([x, y], index) =>
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
    );
    ctx.closePath();
  });

  ctx.stroke();
  ctx.fill();

  ctx.restore();
};
