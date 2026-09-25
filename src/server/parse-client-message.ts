import { type RawData } from 'ws';
import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { type ClientMessage } from '../shared/protocol/network';

const isPlayerInput = (input: unknown): input is PlayerInput =>
  !!input &&
  typeof input === 'object' &&
  Object.entries(emptyPlayerInput()).every(([key, value]) => {
    const received = (input as Record<string, unknown>)[key];

    return (
      typeof received === typeof value &&
      (typeof value !== 'number' || Number.isFinite(received))
    );
  });

export const parseClientMessage = (
  data: RawData,
): ClientMessage | undefined => {
  let message: ClientMessage;

  try {
    message = JSON.parse(
      Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(
            data instanceof ArrayBuffer ? new Uint8Array(data) : data,
          ).toString('utf8'),
    ) as ClientMessage;
  } catch {
    return;
  }

  if (typeof message !== 'object' || message === null) return;

  if (
    message.type === 'input' &&
    (!Number.isSafeInteger(message.tick) ||
      !Number.isSafeInteger(message.sequence) ||
      (message.offset !== undefined && !Number.isFinite(message.offset)) ||
      !isPlayerInput(message.input))
  ) {
    return;
  }

  return message;
};