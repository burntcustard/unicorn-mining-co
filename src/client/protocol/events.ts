import { type EntityId, type PlayerId } from './entities';
import * as Vec from '../utilities/vector';

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
      color: string;
      resource?: number;
      position: Vec.Value;
      type: 'drillDamage';
    }
  | {
      a: EntityId;
      b: EntityId;
      impact: number;
      colors: [string, string];
      // Damage applied to a and b, after checking module immunity.
      damage: [number, number];
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
