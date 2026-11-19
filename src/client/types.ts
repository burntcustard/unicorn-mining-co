import type { RenderingLayer } from '../specs/rendering-layers';
import type { MountPointSpec } from '../specs/mounts';
import * as Vec from './utilities/vector';
import { type Module } from './objects/modules/module';

export type Point = number[];

export type ShapeOutline = Point[] & { edges?: boolean[] };

export type Shades = readonly string[];

export type Pose = { position: Vec.Value; rotation: number };

export type Mount = {
  [key: string]: any;
  localPosition: Vec.Value;
  mountPoints?: (Omit<MountPointSpec, 'fits'> & {
    fits: (typeof Module)[];
  })[];
  health?: number;
  module?: Module | 0;
};

export type Segment = {
  [key: string]: any;
  active: number;
  activationProgress: number;
  health: number;
  hull: boolean;
  lineWidth?: number;
  localPosition: Vec.Value;
  module: any;
  mounts?: Mount[];
  mount?: Mount;
  middle?: Point;
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
  lineJoin?: CanvasLineJoin;
  shades: Shades;
  zIndex: RenderingLayer;
};
