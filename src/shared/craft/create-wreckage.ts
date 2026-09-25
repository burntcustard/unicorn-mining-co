import { Craft } from './craft';
import * as Vec from '../vector';
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
      localPosition: Vec.clone(segment.offset),
      health: segment.health,
      fillShade: segment.fillShade,
      outline: segment.stroke,
    })),
  });
