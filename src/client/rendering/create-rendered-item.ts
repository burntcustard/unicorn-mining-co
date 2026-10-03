import { Item } from '../objects/item';
import { itemTypes } from '../../definitions/items';
import * as Vec from '../utilities/vector';
import { renderItem } from './render-item';

export const createRenderedItem = ({
  add = true,
  position = Vec.create(),
  resource,
}: {
  add?: boolean;
  position?: Vec.Value;
  resource: number;
}) => renderItem({ add, item: new Item(itemTypes[resource], { position }) });
