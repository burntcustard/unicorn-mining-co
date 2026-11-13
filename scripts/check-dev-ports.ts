import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type ViteDevServer } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';

// Use an isolated backend fixture so existing game services stay running.
// Vite uses its normal ports, including fallback when existing services occupy them.
const orders = [
  ['tool', 'server', 'client'],
  ['tool', 'client', 'server'],
  ['server', 'tool', 'client'],
  ['server', 'client', 'tool'],
  ['client', 'tool', 'server'],
  ['client', 'server', 'tool'],
];

for (const tool of [
  'font-viewer',
  'game-object-viewer',
  'sound-editor',
  'world-viewer',
]) {
  for (const order of orders) {
    const services: ViteDevServer[] = [];
    const backend = createHttpServer();
    const sockets = new WebSocketServer({ server: backend });

    sockets.on('connection', (socket) => {
      socket.on('message', (data) => socket.send(data));
    });

    let client: ViteDevServer;

    try {
      for (const service of order) {
        if (service === 'server') {
          backend.listen(43001, '127.0.0.1');
          await once(backend, 'listening');
        } else {
          const vite = await createServer({
            configFile:
              service === 'client'
                ? 'vite.config.ts'
                : `src/tools/${tool}/vite.config.ts`,
            logLevel: 'error',
            server: {
              host: '127.0.0.1',
              ...(service === 'client'
                ? {
                    proxy: {
                      '/game-socket': {
                        target: 'ws://127.0.0.1:43001',
                        ws: true,
                      },
                    },
                  }
                : {}),
            },
          });

          services.push(vite);
          await vite.listen();

          if (service === 'client') client = vite;
          const address = vite.httpServer.address();

          assert(address && typeof address !== 'string');
          assert.notEqual(address.port, 3001);
        }
      }

      const address = client.httpServer.address();

      assert(address && typeof address !== 'string');

      const socket = new WebSocket(
        `ws://127.0.0.1:${address.port}/game-socket`,
        {
          origin: `http://localhost:${address.port}`,
          handshakeTimeout: 3000,
        },
      );

      try {
        await once(socket, 'open');
        const echo = once(socket, 'message');

        socket.send('port check');
        const [data] = await echo;

        assert.equal(data.toString(), 'port check');
      } finally {
        socket.terminate();
      }

      console.log(
        `${tool}: ${order.join(' → ')} passed (client ${address.port})`,
      );
    } finally {
      await Promise.all(services.map((service) => service.close()));
      sockets.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));

      if (backend.listening) {
        await new Promise<void>((resolve) => backend.close(() => resolve()));
      }
    }
  }
}
