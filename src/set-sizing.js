/**
 * All the game's positioning & calculations are done on a 720 x ### grid, but
 * then scaled up to fit on a variable size canvas. That way if a hitbox is
 * e.g. 10x10, it'll be the correct size for calcs no matter the scale.
 * Most numbers used in calcs are floats, so we don't lose much precision by
 * using a small "game board" like this.
 */
export const setSizing = (game) => {
  game.width = 720 * game.size;
  game.scale = window.innerWidth / game.width;
  game.height = window.innerHeight / game.scale;
  game.canvas.width = window.innerWidth;
  game.canvas.height = window.innerHeight;

  // The HUD has a grid of its own, so that zooming the world out by raising
  // game.size shrinks the ships without shrinking the text along with them
  game.uiScale = window.innerWidth / 720;
  game.uiWidth = 720;
  game.uiHeight = window.innerHeight / game.uiScale;
};
