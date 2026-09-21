import { type Vector } from '../vector';
import { type GameObject } from '../game-object';
import { type Segment } from '../types';

export type Outline = number[][] & { edges?: boolean[] };

export type Collider = {
  bounciness?: number;
  dockSegment?: boolean;
  outline?: Outline;
  owner: GameObject;
  part?: unknown;
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
