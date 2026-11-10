import { type HangarAction } from '../protocol/network';
import { type StationSpec } from '../../specs/stations/types';

export const hangarState = {
  busy: false,
  error: '',
  shipsForSale: undefined as StationSpec['shipsForSale'] | undefined,
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
