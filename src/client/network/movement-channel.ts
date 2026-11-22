import * as Vec from '../utilities/vector';
import { type Pose } from '../types';

export type ShipMovement = Pose & {
  id: number;
  spin: number;
  tick: number;
  velocity: Vec.Value;
};

const tickBytes = 8;
const movementBytes = 32;
const maxMovements = 6;

function readMovement(data: ArrayBuffer) {
  const count = (data.byteLength - tickBytes) / movementBytes;

  if (!Number.isInteger(count) || count < 1 || count > maxMovements) {
    return [];
  }

  const view = new DataView(data);
  const tick = Number(view.getBigUint64(0, true));
  const movements: ShipMovement[] = [];

  if (!Number.isSafeInteger(tick)) return movements;

  for (
    let offset = tickBytes;
    offset < data.byteLength;
    offset += movementBytes
  ) {
    const id = Number(view.getBigUint64(offset, true));
    const x = view.getFloat32(offset + 8, true);
    const y = view.getFloat32(offset + 12, true);
    const vx = view.getFloat32(offset + 16, true);
    const vy = view.getFloat32(offset + 20, true);
    const rotation = view.getFloat32(offset + 24, true);
    const spin = view.getFloat32(offset + 28, true);

    if (
      id > 0 &&
      Number.isSafeInteger(id) &&
      [x, y, vx, vy, rotation, spin].every(Number.isFinite)
    ) {
      movements.push({
        id,
        tick,
        position: Vec.create(x, y),
        velocity: Vec.create(vx, vy),
        rotation,
        spin,
      });
    }
  }

  return movements;
}

export class MovementChannel {
  private readonly peer = new RTCPeerConnection();
  private readonly gathering = new AbortController();
  private readonly timeout = setTimeout(() => this.close(), 8000);

  constructor({
    sendOffer,
    receiveMovement,
  }: {
    sendOffer: (sdp: string) => void;
    receiveMovement: (samples: ShipMovement[]) => void;
  }) {
    try {
      const channel = this.peer.createDataChannel('movement', {
        ordered: false,
        maxPacketLifeTime: 32,
      });

      channel.binaryType = 'arraybuffer';
      channel.onopen = () => clearTimeout(this.timeout);
      channel.onclose = channel.onerror = () => this.close();

      channel.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) receiveMovement(readMovement(data));
      };

      this.peer.onconnectionstatechange = () => {
        if (this.peer.connectionState === 'failed') this.close();
      };

      void this.offer(sendOffer).catch(() => this.close());
    } catch {
      this.close();
    }
  }

  private async offer(sendOffer: (sdp: string) => void) {
    await this.peer.setLocalDescription(await this.peer.createOffer());
    const { signal } = this.gathering;

    if (!signal.aborted && this.peer.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });

        this.peer.addEventListener(
          'icegatheringstatechange',
          () => {
            if (this.peer.iceGatheringState === 'complete') resolve();
          },
          { signal },
        );
      });
    }

    const sdp = this.peer.localDescription?.sdp;

    if (!signal.aborted && sdp) sendOffer(sdp);
  }

  answer(sdp: string) {
    if (!this.gathering.signal.aborted) {
      // The production property rewrite leaves keys in JSON literals intact.
      const description: RTCSessionDescriptionInit =
        JSON.parse('{"type":"answer"}');

      description.sdp = sdp;

      void this.peer
        .setRemoteDescription(description)
        .catch(() => this.close());
    }
  }

  close() {
    if (this.gathering.signal.aborted) return;

    clearTimeout(this.timeout);
    this.gathering.abort();
    this.peer.close();
  }
}
