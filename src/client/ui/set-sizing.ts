/**
 * Fit a square world view to the shorter screen dimension. Wider screens
 * reveal more world horizontally, and taller screens reveal more vertically.
 */

export const setSizing = (game: GameState) => {
  game.scale =
    Math.min(window.innerWidth, window.innerHeight) / (720 * game.size);
  game.width = window.innerWidth / game.scale;
  game.height = window.innerHeight / game.scale;
  game.canvas.width = window.innerWidth;
  game.canvas.height = window.innerHeight;
  // Resizing a canvas wipes its context settings, so this goes back on after.
  // Cached artwork should stay sharp, without resampling between its pixels
  game.ctx.imageSmoothingEnabled = false;

  // The HUD has a grid of its own, so that zooming the world out by raising
  // game.size shrinks the ships without shrinking the text along with them
  game.uiScale = Math.min(window.innerWidth, window.innerHeight) / 720;
  game.uiWidth = window.innerWidth / game.uiScale;
  game.uiHeight = window.innerHeight / game.uiScale;
};

import { type GameState } from '../game';
