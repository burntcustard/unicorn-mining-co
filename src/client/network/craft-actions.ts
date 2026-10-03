import { type CraftAction } from '../protocol/network';

let dispatch = (_action: CraftAction) => {};

export const setCraftActionDispatcher = (
  next: (action: CraftAction) => void,
) => {
  dispatch = next;
};

export const sendCraftAction = (action: CraftAction) => dispatch(action);
