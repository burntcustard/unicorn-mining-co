import { type Craft } from './objects/craft';
import { type GameObject } from './objects/game-object';

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
