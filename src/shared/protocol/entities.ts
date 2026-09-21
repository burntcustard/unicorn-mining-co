import { type Vector } from '../../vector';

export type EntityId = number;
export type PlayerId = number;

export type EntityBase = {
  id: EntityId;
  mass: number;
  position: Vector;
  radius: number;
  rotation: number;
  spin: number;
  velocity: Vector;
  update(dt: number): boolean | void;
};

export type ShipEntity = EntityBase & {
  cargo?: number[];
  dockedTo?: EntityId;
  drill: boolean;
  hatch: boolean;
  health: number;
  kind: 'ship';
  launching?: number;
  light: boolean;
  maxSpeed: number;
  paint?: number;
  playerId?: PlayerId;
  shield: boolean;
  thrust: number;
  turn: number;
};

export type AsteroidEntity = EntityBase & {
  contents: number[];
  decay?: number;
  health: number;
  kind: 'asteroid';
  maxHealth: number;
  outline?: number[][];
  points?: number;
  radiusEven?: number;
  resource?: number;
  sections?: AsteroidSection[];
};

export type AsteroidSection = {
  contents: number[];
  health: number;
  mass: number;
  maxHealth: number;
  outline: number[][];
};

export type ItemEntity = EntityBase & {
  kind: 'item';
  resource: number;
};

export type StationEntity = EntityBase & {
  kind: 'station';
};

export type Entity = ShipEntity | AsteroidEntity | ItemEntity | StationEntity;

export type Player = {
  id: PlayerId;
  shipId: EntityId;
};
