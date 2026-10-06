// Fixed values of UC and UM version 1. Keep these stable for a release.
export const controlMessageIds = {
  hello: 0,
  input: 1,
  dock: 2,
  respawn: 3,
  snapshotAck: 4,
  welcome: 5,
  progress: 6,
} as const satisfies Record<string, number>;

export const dockActionIds = {
  buy: 0,
  sell: 1,
  equip: 2,
  remove: 3,
  paint: 4,
  repair: 5,
  buyAmmo: 6,
} as const satisfies Record<string, number>;

export const binaryFieldIds = {
  cargoContents: 1,
  // Reserved legacy ship balance; decoders discard it.
  credits: 2,
  contents: 3,
  decay: 4,
  friction: 5,
  dockedTo: 6,
  health: 7,
  hullHealth: 8,
  kind: 9,
  label: 10,
  launching: 11,
  mass: 12,
  message: 13,
  pendingUpdateTime: 14,
  maxSpeed: 15,
  maxHealth: 16,
  modules: 17,
  wreckage: 18,
  shapeOutline: 19,
  paint: 20,
  shades: 21,
  playerId: 22,
  pointCount: 23,
  position: 24,
  radius: 25,
  radiusEven: 26,
  resource: 27,
  rotation: 28,
  spin: 29,
  segments: 30,
  thrust: 31,
  turn: 32,
  velocity: 33,
  definitionId: 34,
  rounds: 35,
} as const satisfies Record<string, number>;

export const entityKindIds = {
  asteroid: 0,
  item: 1,
  ship: 2,
  station: 3,
  object: 4,
  projectile: 5,
} as const satisfies Record<string, number>;
