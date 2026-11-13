import { graphics } from './dom/graphics';

/**
 * Fit a square world view to the shorter screen dimension. Wider screens
 * reveal more world horizontally, and taller screens reveal more vertically.
 */

export const setSizing = (game: GameState) => {
  const resolution = graphics[3] * (window.devicePixelRatio || 1);

  game.scale =
    (Math.min(window.innerWidth, window.innerHeight) / (720 * game.size)) *
    resolution;
  game.width = (window.innerWidth * resolution) / game.scale;
  game.height = (window.innerHeight * resolution) / game.scale;
  game.canvas.width = window.innerWidth * resolution;
  game.canvas.height = window.innerHeight * resolution;
  // Resizing a canvas wipes its context settings, so this goes back on after.
  // Cached artwork should stay sharp, without resampling between its pixels
  game.ctx.imageSmoothingEnabled = false;

  // The HUD has a grid of its own, independent of the world view size.
  game.uiScale =
    (Math.min(window.innerWidth, window.innerHeight) / 720) * resolution;
  game.uiWidth = (window.innerWidth * resolution) / game.uiScale;
  game.uiHeight = (window.innerHeight * resolution) / game.uiScale;
};

import { type GameState } from '../game';
