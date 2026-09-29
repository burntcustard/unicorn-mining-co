import { type RawData } from 'ws';
import { decodeClientMessage } from '../shared/protocol/binary-control';
import { type ClientMessage } from '../shared/protocol/network';

export const parseClientMessage = (
  data: RawData,
): ClientMessage | undefined => {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data;

  try {
    return decodeClientMessage(bytes);
  } catch {
    return;
  }
};
