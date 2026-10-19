import { type ProxyOptions } from 'vite';
import { type Socket } from 'node:net';

/*
 * Delay only explicitly marked benchmark connections in the development proxy.
 * Native browser sockets keep sending while the renderer initializes audio.
 * This models latency for the two-client check, not bandwidth or backpressure.
 */
export const configureBenchmarkLatency: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReqWs', (request, incoming, socket) => {
    const url = new URL(incoming.url!, 'http://localhost');
    const value = url.searchParams.get('benchmark-delay');

    if (value === null) return;
    const delay = Number(value);

    if (!Number.isFinite(delay) || delay < 0 || delay > 1000) {
      request.destroy(new Error('Invalid benchmark delay'));
      return;
    }

    request.path = url.pathname;

    const delayWrites = (connection: Socket) => {
      const write = connection.write.bind(connection);

      connection.write = (
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | Parameters<Socket['write']>[2],
        callback?: Parameters<Socket['write']>[2],
      ) => {
        setTimeout(() => {
          if (connection.destroyed) return;

          if (typeof encodingOrCallback === 'function') {
            write(chunk, encodingOrCallback);
          } else {
            write(chunk, encodingOrCallback, callback);
          }
        }, delay);

        return true;
      };
    };

    delayWrites(socket as Socket);
    request.on('upgrade', (_response, upstream) => delayWrites(upstream));
  });
};
