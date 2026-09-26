import { type EntityId, type PlayerId } from './entities';
import * as Vec from '../vector';

export type SimulationEvent =
  | { asteroidId: EntityId; childIds: EntityId[]; type: 'asteroidSplit' }
  | {
      asteroidId: EntityId;
      by: PlayerId;
      contents: number[];
      type: 'asteroidDestroyed';
    }
  | {
      targetId: EntityId;
      by: PlayerId;
      damage: number;
      resource?: number;
      position: Vec.Value;
      type: 'drillDamage';
    }
  | {
      a: EntityId;
      b: EntityId;
      impact: number;
      position: Vec.Value;
      type: 'collision';
    }
  | {
      by: PlayerId;
      itemId: EntityId;
      message?: string;
      resource: number;
      unlock?: string;
      type: 'itemCollected';
    }
  | {
      playerId: PlayerId;
      stationId: EntityId;
      type: 'docked';
    }
  | {
      module: 'cargoHatch' | 'shieldGenerator' | 'searchLight';
      playerId: PlayerId;
      active: boolean;
      type: 'moduleChanged';
    };
