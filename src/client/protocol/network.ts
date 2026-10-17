import * as Vec from '../utilities/vector';
import { type PlayerInput } from './input';
import { type AsteroidSegment } from './entities';
import { type ModuleState } from '../objects/craft';
import { type WreckageSegment } from '../objects/wreckage-segment';
import { type WorldSound } from './sounds';

export type NetworkVector = Vec.Value;
export type ReplicatedModule = ModuleState;

export type CraftAction =
  | { action: 'buy'; module: number; moduleId: number; mount?: number }
  | { action: 'buyAmmo' | 'refuel' }
  | { action: 'repairHull'; hullIndex: number }
  | { action: 'sell' | 'buyStock'; objectIds: number[] }
  | { action: 'equip'; moduleId: number; mount: number }
  | { action: 'remove'; mount: number }
  | { action: 'paint'; moduleId?: number; mount?: number; paint: number }
  | { action: 'repair'; moduleId?: number; mount?: number };

export type ReplicatedEntity = {
  cargoContents?: (ReplicatedEntity | { moduleIndex: number })[];
  definitionId?: string;
  contents?: number[];
  decay?: number;
  friction?: number;
  dockedTo?: number;
  health?: number;
  hullHealth?: number[];
  id: number;
  kind:
    | 'asteroid'
    | 'item'
    | 'ship'
    | 'station'
    | 'object'
    | 'projectile'
    | 'jumpGate'
    | 'wormhole';
  opening?: number;
  openingTarget?: number;
  destinationName?: string;
  name?: string;
  launching?: number;
  transitTime?: number;
  transitGate?: number;
  mass?: number;
  message?: string;
  pendingUpdateTime?: number;
  maxSpeed?: number;
  maxHealth?: number;
  modules?: ReplicatedModule[];
  wreckage?: WreckageSegment[];
  shapeOutline?: number[][];
  paint?: number;
  shades?: readonly string[];
  playerId?: number;
  pointCount?: number;
  position: NetworkVector;
  radius: number;
  radiusEven?: number;
  resource?: number;
  rounds?: number;
  fuel?: number;
  storedPower?: number;
  firing?: boolean;
  rotation: number;
  spin: number;
  segments?: AsteroidSegment[];
  thrust?: number;
  turn?: number;
  velocity?: NetworkVector;
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
  | { type: 'gateAccess'; gateId: number }
  | { type: 'chat'; channel: number; text: string }
  | { type: 'profile'; displayName: string }
  | {
      playerToken: string | null;
      type: 'hello' | 'prepare';
    }
  | ({ type: 'dock'; sequence?: number } & CraftAction)
  | { type: 'respawn' | 'activity' | 'play' }
  | { type: 'snapshotAck'; sequence: number }
  | PlayerInputMessage;

export type ServerMessage =
  | {
      type: 'chat';
      channel: number;
      sender: string;
      senderRole: string;
      text: string;
    }
  | { type: 'sounds'; sounds: WorldSound[] }
  | { type: 'profile'; displayName: string }
  | { type: 'progress'; unlockedPaints: number; credits?: number }
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
      displayName?: string;
      worldSeed: number;
      sectorName?: string;
      unlockedPaints?: number;
      credits?: number;
    }
  | {
      snapshotSequence?: number;
      acknowledgedSequence?: number;
      acknowledgedDockSequence?: number;
      credits?: number;
      dockIds?: [number, number][];
      inputLead?: number;
      fullEntities: ReplicatedEntity[];
      // Runtime spawns out of replication range still consume ids, so the
      // counter has to travel or prediction reuses one that is already taken.
      nextEntityId: number;
      serverTick: number;
      type: 'load' | 'snapshot';
      entityIds?: number[];
      asteroidPositions?: NetworkVector[];
    };
