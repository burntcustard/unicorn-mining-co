import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { type ShapeOutline, type Segment } from '../types';
import { type AsteroidSegment } from '../protocol/entities';
import { colors } from '../../definitions/colors';

export type Collider = {
  bounciness?: number;
  friction: number;
  collisionMargin?: number;
  collides?: boolean;
  contactFilter?: (self: Collider, other: Collider) => boolean;
  dockSegment?: boolean;
  shapeOutline?: ShapeOutline;
  owner: GameObject;
  asteroidSegment?: AsteroidSegment;
  pickupPoint?: boolean;
  segment?: Segment;
  speed?: number;
  physics?: boolean;
  localPosition?: Vec.Value;
  position: Vec.Value;
  radius: number;
  role?: 'hornDrill' | 'cargoHatch';
  rotation: number;
};

export type Contact = {
  collider: Collider;
  depth: number;
  normal: Vec.Value;
  other: Collider;
  point: Vec.Value;
};

export const collidersCanContact = (a: Collider, b: Collider) =>
  (!a.contactFilter && !b.contactFilter) ||
  ((a.contactFilter?.(a, b) ?? true) && (b.contactFilter?.(b, a) ?? true));

/**
 * Match the visible stroke of the contacted surface, including module paint.
 */
export const outlineColorOf = (collider: Collider): string => {
  const { segment, owner } = collider;

  if (segment) {
    const shades = segment.hull
      ? segment.shades
      : segment.module.shades || segment.shades;

    return shades?.[2] || colors.white[2];
  }

  if (owner.kind === 'asteroid') {
    return owner.resource === 1 ? colors.violet[2] : colors.white[2];
  }

  return owner.shades?.[2] || colors.white[2];
};
