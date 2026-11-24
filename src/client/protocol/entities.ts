export type EntityId = number;
export type PlayerNumber = number;

export type AsteroidSegment = {
  contents: number[];
  health: number;
  mass: number;
  maxHealth: number;
  shapeOutline: number[][];
};

export type Player = {
  playerNumber: PlayerNumber;
  shipId: EntityId;
};
