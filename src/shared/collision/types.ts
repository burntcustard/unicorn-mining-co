import { type Vector } from '../vector';
import { type GameObject } from '../game-object';
import { type Segment } from '../types';
import { type AsteroidSection } from '../protocol/entities';

export const collisionCategories = {
  solid: 1,
  pickupPoint: 2,
  scoopMouth: 4,
} as const;

export type Outline = number[][] & { edges?: boolean[] };

export type Collider = {
  bounciness?: number;
  collisionMargin?: number;
  collisionCategory?: number;
  collisionMask?: number;
  collides?: boolean;
  dockSegment?: boolean;
  outline?: Outline;
  owner: GameObject;
  part?: AsteroidSection;
  pickupPoint?: boolean;
  segment?: Segment;
  speed?: number;
  physics?: boolean;
  position: Vector;
  radius: number;
  role?: 'drill' | 'scoop';
  rotation: number;
};

export type Contact = {
  collider: Collider;
  depth: number;
  normal: Vector;
  other: Collider;
  point: Vector;
};
