import * as Vec from './vector';
import { type Module } from './modules/module';

export type Point = number[];
export type ShapeOutline = Point[] & { edges?: boolean[] };
export type Shades = readonly string[];

export type ModuleSegmentPlan = {
  [key: string]: any;
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
};

export type Mount = {
  [key: string]: any;
  localPosition: Vec.Value;
  health?: number;
  module?: Module | 0;
};

export type Segment = {
  [key: string]: any;
  active: number;
  activationProgress: number;
  health: number;
  hull: boolean;
  localPosition: Vec.Value;
  module: any;
  mounts?: Mount[];
  mount?: Mount;
  middle?: Point;
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
  shades: Shades;
  zIndex: number;
};
