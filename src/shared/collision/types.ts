import { type Vector } from '../vector';
import { type GameObject } from '../game-object';
import { type Segment } from '../types';
import { type AsteroidSegment } from '../protocol/entities';

export type Outline = number[][] & { edges?: boolean[] };

export type Collider = {
  bounciness?: number;
  friction: number;
  collisionMargin?: number;
  collides?: boolean;
  contactFilter?: (self: Collider, other: Collider) => boolean;
  dockSegment?: boolean;
  outline?: Outline;
  owner: GameObject;
  asteroidSegment?: AsteroidSegment;
  pickupPoint?: boolean;
  segment?: Segment;
  speed?: number;
  physics?: boolean;
  position: Vector;
  radius: number;
  role?: 'hornDrill' | 'cargoHatch';
  rotation: number;
};

export type Contact = {
  collider: Collider;
  depth: number;
  normal: Vector;
  other: Collider;
  point: Vector;
};

export const collidersCanContact = (a: Collider, b: Collider) =>
  (!a.contactFilter && !b.contactFilter) ||
  ((a.contactFilter?.(a, b) ?? true) && (b.contactFilter?.(b, a) ?? true));
