import { itemTypes } from '../shared/items';
import * as Vec from '../shared/vector';
import { renderItem } from './render-item';

export const createRenderedItem = ({
  add = true,
  position = Vec.create(),
  resource,
}: {
  add?: boolean;
  position?: Vec.Value;
  resource: number;
}) => renderItem({ add, item: new itemTypes[resource]({ position }) });
