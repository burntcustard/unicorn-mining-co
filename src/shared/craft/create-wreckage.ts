import { Craft } from './craft';
import { Vector } from '../vector';
import { type WreckageSegment } from './wreckage-segment';

export const createWreckage = ({
  properties,
  segments,
}: {
  properties: ConstructorParameters<typeof Craft>[0];
  segments: WreckageSegment[];
}) =>
  new Craft(properties, {
    hullSegments: segments.map((segment) => ({
      points: segment.outline,
      radius: () => segment.radius,
      localPosition: Vector(segment.offset.x, segment.offset.y),
      health: segment.health,
      fillShade: segment.fillShade,
      outline: segment.stroke,
    })),
  });
