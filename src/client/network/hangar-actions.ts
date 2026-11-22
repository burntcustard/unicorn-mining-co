import { type HangarAction } from '../protocol/network';
import { type ShipOffer } from '../../specs/stations/types';

export const hangarState = {
  busy: false,
  error: '',
  shipsForSale: undefined as ShipOffer[] | undefined,
};

let dispatch: (action: HangarAction) => void = () => {
  hangarState.busy = false;
  hangarState.error = 'Connect to the server to use the hangar.';
};

export const setHangarActionDispatcher = (next: typeof dispatch) => {
  dispatch = next;
};

export const applyHangarAction = (
  command: HangarAction['command'],
  shipId = 0,
  value = '',
) => {
  if (hangarState.busy) return;
  hangarState.busy = true;
  hangarState.error = '';

  if (command === 'LIST') hangarState.shipsForSale = undefined;
  dispatch({ command, shipId, value });
};
