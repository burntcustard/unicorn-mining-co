import { type RawData } from 'ws';
import { unpackPlayerInput } from '../shared/protocol/input';
import { type ClientMessage } from '../shared/protocol/network';

export const parseClientMessage = (
  data: RawData,
): ClientMessage | undefined => {
  let message: unknown;

  try {
    message = JSON.parse(
      Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(
            data instanceof ArrayBuffer ? new Uint8Array(data) : data,
          ).toString('utf8'),
    );
  } catch {
    return;
  }

  // Input packets use [tick, sequence, control bits, offset?].
  if (Array.isArray(message)) {
    if (message.length < 3 || message.length > 4) return;
    const [tick, sequence, code, offset] = message;

    if (!Number.isInteger(code) || code < 0 || code >= 192) {
      return;
    }

    return {
      type: 'input',
      tick,
      sequence,
      input: unpackPlayerInput(code),
      offset,
    };
  }

  if (typeof message !== 'object' || message === null) return;
  const other = message as ClientMessage;

  if (other.type === 'input') return;
  return other;
};
