import { type Craft } from './objects/craft';
import { type GameObject } from './objects/game-object';
import { type Ship } from './objects/ship';
import type * as Vec from './utilities/vector';

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
  sprites: GameObject[];
  crafts: Craft[];
  // Presentation can follow another ship without changing local ownership.
  viewShip?: Ship;
  camera?: Vec.Value;
};

export const game = {
  crafts: [],
  // @ifdef DEBUG
  physicsOn: true,
  // @endif
  size: 1.5,
  sprites: [],
  uiAlpha: 0,
  uiVisible: 0,
  // Canvas and context are set by main; sizing is set by setSizing().
} as GameState;
