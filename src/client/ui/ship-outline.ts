import { type Craft } from '../objects/craft';
import { rotatePoint, rotatePoints } from '../utilities/geometry';

/**
 * Current intact hull, drill, and thruster geometry for compact ship views.
 */
export const shipOutlines = ({
  ship,
  rotation = 0,
  hullOnly = false,
}: {
  ship: Pick<Craft, 'segments'>;
  rotation?: number;
  hullOnly?: boolean;
}) =>
  ship.segments
    .filter(
      (segment) =>
        (segment.hull ||
          (!hullOnly && (segment.module.drillTip || segment.flareSize))) &&
        !(segment.health < 1),
    )
    .map((segment) => {
      const size = segment.flareSize;
      const points = size
        ? [
            [0, -size],
            [-size * 2.5, 0],
            [0, size],
          ]
        : typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points;

      return rotatePoints(
        points || [],
        rotation,
        rotatePoint(segment.localPosition, rotation),
      );
    });
