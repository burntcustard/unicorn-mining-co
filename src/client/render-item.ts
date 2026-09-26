import { type Item } from '../shared/items/item';
import { game } from './game';
import './items/item';

export const renderItem = ({
  add = true,
  item,
}: {
  add?: boolean;
  item: Item;
}) => {
  item.collections = [game.sprites];
  item.networked = 1;
  item.fill = item.shades[1];
  item.stroke = item.shades[2];

  if (add) item.add();
  return item;
};
