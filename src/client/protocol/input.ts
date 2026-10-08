/**
 * Commands for one player during a single simulation tick.
 */
export type PlayerInput = {
  fire?: boolean;
  plasmaActive?: boolean;
  autogunActive?: boolean;
  laserActive?: boolean;
  hornDrill: boolean;
  cargoHatch: boolean;
  searchLight: boolean;
  launch: boolean;
  shieldGenerator: boolean;
  thrust: number;
  turn: number;
};

/**
 * Bit order: drill, hatch, light, shield, launch, thrust, left, right,
 * fire, plasma activation, autogun activation, laser activation.
 * Keyboard thrust is 0 or 1; turn is -1, 0, or 1.
 */
export const packPlayerInput = (input: PlayerInput) =>
  [
    input.hornDrill,
    input.cargoHatch,
    input.searchLight,
    input.shieldGenerator,
    input.launch,
    input.thrust === 1,
    input.turn === -1,
    input.turn === 1,
    input.fire,
    input.plasmaActive,
    input.autogunActive,
    input.laserActive,
  ].reduce((code, active, bit) => code | (Number(active) << bit), 0);

/**
 * Decode a control mask after the server has validated its wire value.
 */
export const unpackPlayerInput = (code: number): PlayerInput => {
  const bit = (index: number) => (code >> index) & 1;

  return {
    ...(bit(8) && { fire: true }),
    ...(bit(9) && { plasmaActive: true }),
    ...(bit(10) && { autogunActive: true }),
    ...(bit(11) && { laserActive: true }),
    hornDrill: !!bit(0),
    cargoHatch: !!bit(1),
    searchLight: !!bit(2),
    shieldGenerator: !!bit(3),
    launch: !!bit(4),
    thrust: bit(5),
    turn: bit(7) - bit(6),
  };
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
  !!a.fire === !!b.fire &&
  !!a.plasmaActive === !!b.plasmaActive &&
  !!a.autogunActive === !!b.autogunActive &&
  !!a.laserActive === !!b.laserActive &&
  a.hornDrill === b.hornDrill &&
  a.cargoHatch === b.cargoHatch &&
  a.searchLight === b.searchLight &&
  a.launch === b.launch &&
  a.shieldGenerator === b.shieldGenerator &&
  a.thrust === b.thrust &&
  a.turn === b.turn;
