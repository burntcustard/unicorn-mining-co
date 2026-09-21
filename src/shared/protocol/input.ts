/** Commands for one player during a single simulation tick. */
export type PlayerInput = {
  drill: boolean;
  hatch: boolean;
  light: boolean;
  launch: boolean;
  shield: boolean;
  thrust: number;
  turn: number;
};

export const emptyPlayerInput = (): PlayerInput => ({
  drill: false,
  hatch: false,
  light: false,
  launch: false,
  shield: false,
  thrust: 0,
  turn: 0,
});

/**
 * Both sides only record an input when it changes and read back the newest one
 * at or before a tick, so telling two apart is part of the protocol.
 */
export const sameInput = (a: PlayerInput, b: PlayerInput) =>
  a.drill === b.drill &&
  a.hatch === b.hatch &&
  a.light === b.light &&
  a.launch === b.launch &&
  a.shield === b.shield &&
  a.thrust === b.thrust &&
  a.turn === b.turn;
