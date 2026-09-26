import { type RawData } from 'ws';
import { unpackPlayerInput } from '../shared/protocol/input';
import { type ClientMessage } from '../shared/protocol/network';
import { simulationStep } from '../shared/settings';

const integer = (value: unknown) => Number.isSafeInteger(value);
const nonnegative = (value: unknown) =>
  integer(value) && (value as number) >= 0;
const optionalId = (value: unknown) => value === undefined || integer(value);
const token = (value: unknown) =>
  value === null ||
  (typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ));

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

    if (
      !nonnegative(tick) ||
      !nonnegative(sequence) ||
      !Number.isInteger(code) ||
      code < 0 ||
      code >= 192 ||
      (offset !== undefined &&
        (typeof offset !== 'number' ||
          !Number.isFinite(offset) ||
          offset < 0 ||
          offset >= simulationStep))
    ) {
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
  const other = message as Record<string, unknown>;

  if (other.type === 'hello' && token(other.playerToken)) {
    return other as ClientMessage;
  }

  if (other.type === 'respawn') return { type: 'respawn' };

  if (other.type !== 'dock') return;

  const action = other.action;
  const moduleId = other.moduleId;
  const mount = other.mount;

  if (action === 'buy' && nonnegative(other.module) && integer(moduleId)) {
    return other as ClientMessage;
  }

  if (
    action === 'sell' &&
    Array.isArray(other.objectIds) &&
    other.objectIds.length > 0 &&
    other.objectIds.length <= 100 &&
    other.objectIds.every(integer)
  ) {
    return other as ClientMessage;
  }

  if (action === 'equip' && integer(moduleId) && nonnegative(mount)) {
    return other as ClientMessage;
  }

  if (action === 'remove' && nonnegative(mount)) return other as ClientMessage;

  if (
    action === 'paint' &&
    nonnegative(other.paint) &&
    optionalId(moduleId) &&
    optionalId(mount)
  ) {
    return other as ClientMessage;
  }

  if (action === 'repair' && optionalId(moduleId) && optionalId(mount)) {
    return other as ClientMessage;
  }
};
