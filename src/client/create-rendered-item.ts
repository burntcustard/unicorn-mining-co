import { itemTypes } from '../shared/items';
import { Vector, type Vector as VectorValue } from '../shared/vector';
import { renderItem } from './render-item';

export const createRenderedItem = ({
  add = true,
  position = Vector(),
  resource,
}: {
  add?: boolean;
  position?: VectorValue;
  resource: number;
}) => renderItem({ add, item: new itemTypes[resource]({ position }) });
