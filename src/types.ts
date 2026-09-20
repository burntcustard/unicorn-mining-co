import { type Vector } from './vector';

declare global {
  const canvas: HTMLCanvasElement;
}

export type Point = number[];
export type Outline = Point[] & { edges?: boolean[] };
export type Palette = readonly string[];

export type GameState = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scale: number;
  size: number;
  uiAlpha: number;
  uiHeight: number;
  uiScale: number;
  uiVisible: number;
  uiWidth: number;
  physicsOn?: boolean;
  sprites: WorldObject[];
  crafts: Craft[];
};

export type WorldObject = {
  [key: string]: any;
  position: Vector;
  velocity: Vector;
  radius: number;
  rotation: number;
  hitboxes?: () => WorldObject[];
};

export type Module = {
  [key: string]: any;
  health?: number;
  model?: ModulePart[];
  name?: string;
};

export type ModulePart = {
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
  module: Module;
  mounts?: Mount[];
  mount?: Mount;
  middle?: Point;
  points?: Outline | ((segment: Segment) => Outline);
  shades: Palette;
  zIndex: number;
};

export type Craft = WorldObject & {
  [key: string]: any;
  cargo: WorldObject[];
  segments: Segment[];
};

export type Collider = WorldObject & {
  [key: string]: any;
  owner?: Craft | WorldObject;
  segment?: Segment;
};

export type Contact = {
  collider: Collider;
  depth: number;
  normal: Vector;
  other: Collider;
  point?: Point;
};
