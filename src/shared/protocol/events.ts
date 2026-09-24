import { type EntityId, type PlayerId } from './entities';
import { type Vector } from '../vector';

export type SimulationEvent =
  | { asteroidId: EntityId; childIds: EntityId[]; type: 'asteroidSplit' }
  | {
      asteroidId: EntityId;
      by: PlayerId;
      contents: number[];
      type: 'asteroidDestroyed';
    }
  | {
      asteroidId: EntityId;
      by: PlayerId;
      damage: number;
      resource?: number;
      position: Vector;
      type: 'asteroidMined';
    }
  | {
      a: EntityId;
      b: EntityId;
      impact: number;
      position: Vector;
      type: 'collision';
    }
  | {
      by: PlayerId;
      itemId: EntityId;
      resource: number;
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
