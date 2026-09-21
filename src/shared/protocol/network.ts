import { type PlayerInput } from './input';
import { type AsteroidSection } from './entities';

export const protocolVersion = 6;

export type NetworkVector = { x: number; y: number };

export type ReplicatedEntity = {
  contents?: number[];
  decay?: number;
  dockedTo?: number;
  drill?: boolean;
  hatch?: boolean;
  health?: number;
  id: number;
  kind: 'asteroid' | 'item' | 'ship' | 'station';
  launching?: number;
  light?: boolean;
  mass: number;
  maxSpeed?: number;
  maxHealth?: number;
  outline?: number[][];
  paint?: number;
  playerId?: number;
  points?: number;
  position: NetworkVector;
  radius: number;
  radiusEven?: number;
  resource?: number;
  rotation: number;
  shield?: boolean;
  spin: number;
  sections?: AsteroidSection[];
  thrust?: number;
  turn?: number;
  velocity: NetworkVector;
};

export type ReplicatedStationMarker = {
  id: number;
  position: NetworkVector;
  radius: number;
  type: 'station';
};

export type PlayerCheckpoint = {
  acknowledgedSequence?: number;
  dockedTo?: number;
  drill: boolean;
  entityId: number;
  hatch: boolean;
  health: number;
  /** How far ahead of the server the owner's last input arrived, in ticks. */
  inputLead?: number;
  launching?: number;
  light: boolean;
  playerId: number;
  position: NetworkVector;
  rotation: number;
  shield: boolean;
  spin: number;
  thrust: number;
  tick: number;
  turn: number;
  velocity: NetworkVector;
};

export type PlayerInputMessage = {
  input: PlayerInput;
  sequence: number;
  tick: number;
  type: 'input';
};

export type ClientMessage =
  | {
      playerToken: string | null;
      protocolVersion: number;
      type: 'hello';
    }
  | PlayerInputMessage;

export type ServerMessage =
  | {
      playerId: number;
      playerToken: string;
      protocolVersion: number;
      serverTick: number;
      shipId: number;
      spawn: NetworkVector;
      type: 'welcome';
      worldSeed: number;
    }
  | {
      checkpoints: PlayerCheckpoint[];
      fullEntities: ReplicatedEntity[];
      serverTick: number;
      stationMarkers: ReplicatedStationMarker[];
      type: 'load';
    }
  | {
      checkpoints: PlayerCheckpoint[];
      fullEntities: ReplicatedEntity[];
      serverTick: number;
      stationMarkers: ReplicatedStationMarker[];
      type: 'snapshot';
      unloadedEntityIds: number[];
      unloadedStationMarkerIds: number[];
    };
