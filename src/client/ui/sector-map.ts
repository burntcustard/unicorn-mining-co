import { senderColor } from './sender-color';
import { type Ship } from '../objects/ship';
import { type Pose } from '../types';
import { type MapMarker } from '../protocol/network';
import { replication } from '../../specs/replication';
import { renderLandmarkIcon } from './landmark-icon';
import { shipOutlines } from './ship-outline';
import { withAlpha } from '../utilities/color';
import * as Vec from '../utilities/vector';

export const mapRange = replication.entityUnload * 8;

/**
 * Render a sector viewport from field descriptions and lightweight contacts.
 */
export const renderSectorMap = ({
  ctx,
  ship,
  poses,
  mapCenter,
  mapMarkers,
  displayName,
  displayScale,
  range = mapRange,
}: {
  ctx: CanvasRenderingContext2D;
  ship: Ship;
  poses: Map<number, Pose>;
  mapCenter: Vec.Value;
  mapMarkers: MapMarker[];
  displayName: string;
  displayScale: number;
  range?: number;
}) => {
  const scale = 296 / range;
  const iconRadius = 7 * displayScale;
  const outline = withAlpha({ color: '#000', alpha: 0.8 });
  const offset = (position: Vec.Value) =>
    Vec.scale(Vec.subtract(position, mapCenter), scale);

  ctx.clearRect(0, 0, 600, 600);
  ctx.save();
  ctx.beginPath();
  ctx.arc(300, 300, 298, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(300, 300);
  ctx.lineWidth = 2 * displayScale;
  ctx.strokeStyle = withAlpha({ color: '#eef', alpha: 0.12 });
  ctx.beginPath();
  const spacing = 10000;

  for (let axis = 0; axis < 2; axis++) {
    const center = axis ? mapCenter.y : mapCenter.x;

    for (
      let value = Math.ceil((center - range) / spacing) * spacing;
      value <= center + range;
      value += spacing
    ) {
      const line = (value - center) * scale;

      ctx.moveTo(axis ? -300 : line, axis ? line : -300);
      ctx.lineTo(axis ? 300 : line, axis ? line : 300);
    }
  }

  ctx.stroke();
  ctx.lineJoin = 'round';

  const label = (name: string, y: number, color: string) => {
    ctx.font = `bold ${14 * displayScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * displayScale;
    ctx.strokeStyle = outline;
    ctx.strokeText(name, 0, y);
    ctx.fillStyle = color;
    ctx.fillText(name, 0, y);
  };

  // Field circles use their real footprint; individual asteroid data is unused.
  mapMarkers.forEach((marker) => {
    if (marker.kind !== 'field') return;
    const position = offset(marker.position);
    const radius = marker.radius * scale;

    if (Vec.lengthSquared(position) > (298 + radius + 2 * displayScale) ** 2) {
      return;
    }

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha({ color: '#fff', alpha: 0.05 });
    ctx.fill();
    ctx.strokeStyle = withAlpha({ color: '#fff', alpha: 0.65 });
    ctx.lineWidth = 1.5 * displayScale;
    ctx.stroke();
  });

  mapMarkers.forEach((marker) => {
    if (
      marker.kind === 'field' ||
      (marker.kind === 'ship' && marker.id === ship.id)
    ) {
      return;
    }

    const pose = marker.kind === 'ship' ? poses.get(marker.id) : undefined;
    const position = offset(pose?.position || marker.position);

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.lineWidth = 6 * displayScale;

    if (marker.kind === 'ship') {
      ctx.beginPath();

      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3 - Math.PI / 2;

        ctx.lineTo(Math.cos(angle) * iconRadius, Math.sin(angle) * iconRadius);
      }

      ctx.closePath();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 4 * displayScale;
      ctx.stroke();
      ctx.fillStyle = marker.color;
      ctx.fill();
      label(
        marker.name,
        iconRadius + 5 * displayScale,
        senderColor(marker.senderRole || ''),
      );
    } else {
      renderLandmarkIcon({ ctx, object: marker, radius: iconRadius, outline });
      ctx.lineWidth = 2 * displayScale;
      renderLandmarkIcon({ ctx, object: marker, radius: iconRadius });
    }

    ctx.restore();
  });

  const pose = poses.get(ship.id) || ship;
  const position = offset(pose.position);

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.save();
  ctx.rotate(pose.rotation);
  const outlines = shipOutlines({ ship, hullOnly: true });
  const radius = Math.max(
    1,
    ...outlines.flat().map(([x, y]) => Math.hypot(x, y)),
  );
  const hullScale = (iconRadius * 2) / radius;

  ctx.scale(hullScale, hullScale);
  ctx.lineWidth = (4 * displayScale) / hullScale;
  ctx.strokeStyle = outline;
  ctx.fillStyle = ship.shades[2];
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
  const ownRole =
    mapMarkers.find((marker) => marker.kind === 'ship' && marker.id === ship.id)
      ?.senderRole || '';

  label(
    displayName,
    iconRadius * 2 + 5 * displayScale,
    senderColor(ownRole, true),
  );
  ctx.restore();
  ctx.restore();
};
