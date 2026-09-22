import { type Vector } from '../../vector';
import { type GameObject } from '../../game-object';
import { type Segment } from '../../types';
import { type AsteroidSection } from '../../protocol/entities';

export type Outline = number[][] & { edges?: boolean[] };

export type Collider = {
  bounciness?: number;
  collisionMargin?: number;
  dockSegment?: boolean;
  outline?: Outline;
  owner: GameObject;
  part?: AsteroidSection;
  segment?: Segment;
  speed?: number;
  physics?: boolean;
  position: Vector;
  radius: number;
  role?: 'drill' | 'scoop';
  rotation: number;
};

export type Contact = {
  swept?: boolean;
  collider: Collider;
  depth: number;
  normal: Vector;
  other: Collider;
  point: Vector;
};
