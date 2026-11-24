import { type EntityId, type PlayerNumber } from './entities';
import * as Vec from '../utilities/vector';
import { type EffectSpec } from '../effects/effect';

export type SimulationEvent =
  | {
      effect: EffectSpec;
      objectId: EntityId;
      position: Vec.Value;
      type: 'explosion';
    }
  | {
      type: 'objectDestroyed';
      objectId: EntityId;
      color: string;
      damage: number;
      position: Vec.Value;
    }
  | { asteroidId: EntityId; childIds: EntityId[]; type: 'asteroidSplit' }
  | {
      asteroidId: EntityId;
      by: PlayerNumber;
      contents: number[];
      type: 'asteroidDestroyed';
    }
  | {
      targetId: EntityId;
      by: PlayerNumber;
      damage: number;
      color: string;
      resource?: number;
      position: Vec.Value;
      type: 'drillDamage' | 'laserDamage';
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
      by: PlayerNumber;
      itemId: EntityId;
      message?: string;
      resource: number;
      unlock?: string;
      type: 'itemCollected';
    }
  | {
      playerNumber: PlayerNumber;
      dockedTo: EntityId;
      type: 'docked';
    }
  | {
      module: 'cargoHatch' | 'shieldGenerator' | 'searchLight' | 'flightMode';
      playerNumber: PlayerNumber;
      active: boolean;
      type: 'moduleChanged';
    };
