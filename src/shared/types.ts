import { type Vector } from './vector';
import { type Module } from './modules/module';

export type Point = number[];
export type Outline = Point[] & { edges?: boolean[] };
export type Shades = readonly string[];

export type GameObjectLike = {
  [key: string]: any;
  position: Vector;
  velocity: Vector;
  radius: number;
  rotation: number;
  hitbox?: () => unknown[];
};

export type ModuleSegmentPlan = {
  [key: string]: any;
  points?: Outline | ((segment: Segment) => Outline);
};

export type Mount = {
  [key: string]: any;
  localPosition: Vector;
  health?: number;
  module?: Module | 0;
};

export type Segment = {
  [key: string]: any;
  active: number;
  activationProgress: number;
  health: number;
  hull: boolean;
  localPosition: Vector;
  module: any;
  mounts?: Mount[];
  mount?: Mount;
  middle?: Point;
  points?: Outline | ((segment: Segment) => Outline);
  shades: Shades;
  zIndex: number;
};
