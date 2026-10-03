export type EntityId = number;
export type PlayerId = number;

export type AsteroidSegment = {
  contents: number[];
  health: number;
  mass: number;
  maxHealth: number;
  shapeOutline: number[][];
};

export type Player = {
  id: PlayerId;
  shipId: EntityId;
};
