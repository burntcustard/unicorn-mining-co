import { Vector, type Vector as VectorValue } from '../../vector';
import { type StationEntity } from '../protocol/entities';
import { SimulationEntity } from './entity';

class Station extends SimulationEntity implements StationEntity {
  kind = 'station' as const;
}

export const createStation = ({
  id,
  position = Vector(),
  radius,
  spin = 0,
}: {
  id: number;
  position?: VectorValue;
  radius: number;
  spin?: number;
}): StationEntity => new Station({ id, position, radius, spin });
