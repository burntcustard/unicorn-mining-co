import * as Vec from '../vector';
import { type PlayerInput } from './input';
import { type AsteroidSegment } from './entities';
import { type ModuleState } from '../craft/module-state';
import { type WreckageSegment } from '../craft/wreckage-segment';

export type NetworkVector = Vec.Value;
export type ReplicatedModule = ModuleState;
export type CraftAction =
  | { action: 'buy'; module: number; moduleId: number }
  | { action: 'sell'; objectIds: number[] }
  | { action: 'equip'; moduleId: number; mount: number }
  | { action: 'remove'; mount: number }
  | { action: 'paint'; moduleId?: number; mount?: number; paint: number }
  | { action: 'repair'; moduleId?: number; mount?: number };

export type ReplicatedEntity = {
  cargoContents?: (ReplicatedEntity | { moduleIndex: number })[];
  credits?: number;
  contents?: number[];
  decay?: number;
  friction?: number;
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
  wreckage?: WreckageSegment[];
  outline?: number[][];
  paint?: number;
  shades?: readonly string[];
  playerId?: number;
  pointCount?: number;
  position: NetworkVector;
  radius: number;
  radiusEven?: number;
  resource?: number;
  rotation: number;
  spin: number;
  segments?: AsteroidSegment[];
  thrust?: number;
  turn?: number;
  velocity: NetworkVector;
};

export type PlayerInputMessage = {
  input: PlayerInput;
  /**
   * Seconds into the simulation tick; omitted by tick-aligned callers.
   */
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
  | ({ type: 'dock' } & CraftAction)
  | { type: 'respawn' }
  | PlayerInputMessage;

export type ServerMessage =
  | {
      shipId: number;
      type: 'respawn';
    }
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
