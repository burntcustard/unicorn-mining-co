import { init } from './core';
import { type Craft } from '../shared/craft/craft';
import { type GameObject } from '../shared/game-object';

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

const { canvas, context } = init();

export const game = {
  canvas,
  crafts: [],
  ctx: context,
  // @ifdef DEBUG
  physicsOn: true,
  // @endif
  size: 1.5,
  sprites: [],
  uiAlpha: 0,
  uiVisible: 0,
  // scale, width & height are set by setSizing()
} as GameState;
