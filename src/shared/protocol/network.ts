import { type PlayerInput } from './input';
import { type AsteroidSection } from './entities';
import { type ModuleState } from '../craft/module-state';
import { type WreckagePart } from '../craft/wreckage-part';

export type NetworkVector = { x: number; y: number };
export type ReplicatedModule = ModuleState;

export type ReplicatedEntity = {
  cargoContents?: (ReplicatedEntity | { moduleIndex: number })[];
  contents?: number[];
  decay?: number;
  dockedTo?: number;
  health?: number;
  hullHealth?: number[];
  id: number;
  kind: 'asteroid' | 'item' | 'ship' | 'station' | 'object';
  label?: string;
  launching?: number;
  mass: number;
  pendingUpdateTime: number;
  maxSpeed?: number;
  maxHealth?: number;
  modules?: ReplicatedModule[];
  wreckage?: WreckagePart[];
  outline?: number[][];
  paint?: number;
  shades?: readonly string[];
  playerId?: number;
  points?: number;
  position: NetworkVector;
  radius: number;
  radiusEven?: number;
  resource?: number;
  rotation: number;
  spin: number;
  sections?: AsteroidSection[];
  thrust?: number;
  turn?: number;
  velocity: NetworkVector;
};

export type PlayerInputMessage = {
  input: PlayerInput;
  /** Seconds into the simulation tick; omitted by tick-aligned callers. */
  offset?: number;
  sequence: number;
  tick: number;
  type: 'input';
};

export type ClientMessage =
  | {
      playerToken: string | null;
      type: 'hello';
    }
  | PlayerInputMessage;

export type ServerMessage =
  | {
      playerId: number;
      playerToken: string;
      serverTick: number;
      shipId: number;
      spawn: NetworkVector;
      type: 'welcome';
      worldSeed: number;
    }
  | {
      acknowledgedSequence?: number;
      inputLead?: number;
      fullEntities: ReplicatedEntity[];
      serverTick: number;
      type: 'load' | 'snapshot';
      entityIds: number[];
    };
