/**
 * Based on Kontra keyboard.js
 * https://github.com/straker/kontra/blob/master/src/keyboard.js
 *
 * But using event.key rather than event.which
 */

// Store callbacks for single key pressed events
let callbacks = {};

// Same as Kontra pressedKeys - a list of keys that are "held down", i.e.
// haven't had a keyup even to "turn them off" yet.
let downKeys = {};

/**
 * Execute a function that corresponds to a keyboard key.
 *
 * @param {KeyboardEvent} event
 */
const keyEventHandler = (event) => {
  const key = event.key.slice(-2);
  downKeys[key] = event.type === 'keydown';
  if (downKeys[key] && !event.repeat) callbacks[key]?.(event);
};

/**
 * Reset pressed keys.
 * Window "barely ever" gets blurred while keys held down so don't need this.
 * We could re-add it if we have space.
 */
// function blurEventHandler() {
//   pressedKeys = {};
// }

/**
 * Initialize keyboard event listeners. This function must be called before using other keyboard functions.
 * @function initKeys
 */
export const initKeys = () => {
  window.addEventListener('keydown', keyEventHandler);
  window.addEventListener('keyup', keyEventHandler);
  // window.addEventListener('blur', blurEventHandler);
};

/**
 * [bindKeys description]
 * @param  {Array}   keys     Array of KeyboardEvent.key codes -
 * developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
 * @param  {Function} callback [description]
 */
export const bindKeys = (key, callback) => callbacks[key] = callback;

/**
 * [unbindKeys description]
 * @param  {Array}   keys     Array of KeyboardEvent.key codes -
 * developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
 */
export const unbindKeys = (keys) => keys.map((key) => callbacks[key] = false);

// We may not need this and/or unbind keys?...
export const unbindAllKeys = () => callbacks = {};

export const keyDown = (key) => !!downKeys[key];
