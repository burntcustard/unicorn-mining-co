import type { RenderingLayer } from '../specs/rendering-layers';
import * as Vec from './utilities/vector';
import { type Module } from './objects/modules/module';

export type Point = number[];

export type ShapeOutline = Point[] & { edges?: boolean[] };

export type Shades = readonly string[];

export type Pose = { position: Vec.Value; rotation: number };

export type ModuleSegmentPlan = {
  [key: string]: any;
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
};

export type Mount = {
  [key: string]: any;
  localPosition: Vec.Value;
  mountPoints?: {
    x: number;
    y: number;
    thrusterOffset?: number;
    fits: (typeof Module)[];
  }[];
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
  zIndex: RenderingLayer;
};
