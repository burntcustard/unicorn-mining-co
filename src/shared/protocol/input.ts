/**
 * Commands for one player during a single simulation tick.
 */
export type PlayerInput = {
  hornDrill: boolean;
  cargoHatch: boolean;
  searchLight: boolean;
  launch: boolean;
  shieldGenerator: boolean;
  thrust: number;
  turn: number;
};

export const emptyPlayerInput = (): PlayerInput => ({
  hornDrill: false,
  cargoHatch: false,
  searchLight: false,
  launch: false,
  shieldGenerator: false,
  thrust: 0,
  turn: 0,
});

/**
 * Only changed controls need a new transition; held keys need no repeat packets.
 */
export const sameInput = (a: PlayerInput, b: PlayerInput) =>
  a.hornDrill === b.hornDrill &&
  a.cargoHatch === b.cargoHatch &&
  a.searchLight === b.searchLight &&
  a.launch === b.launch &&
  a.shieldGenerator === b.shieldGenerator &&
  a.thrust === b.thrust &&
  a.turn === b.turn;
