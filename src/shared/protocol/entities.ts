export type EntityId = number;
export type PlayerId = number;

export type AsteroidSection = {
  contents: number[];
  health: number;
  mass: number;
  maxHealth: number;
  outline: number[][];
};

export type Player = {
  id: PlayerId;
  shipId: EntityId;
};
