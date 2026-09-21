import { type EntityId, type PlayerId } from './entities';

export type SimulationEvent =
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
      type: 'asteroidMined';
    }
  | {
      a: EntityId;
      b: EntityId;
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
      module: 'hatch' | 'shield' | 'light';
      playerId: PlayerId;
      active: boolean;
      type: 'moduleChanged';
    };
