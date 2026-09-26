import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { parseClientMessage } from './parse-client-message';
import { simulationStep } from '../shared/settings';
import { GameSession } from './game-session';
import { handleHttp } from './http-handler';

export class GameServer {
  readonly worldSeed: number;
  readonly world;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private port: number;
  private session: GameSession;
  private server?: WebSocketServer;
  private http?: Server;

  constructor({
    port = 3001,
    worldSeed = 25,
  }: { port?: number; worldSeed?: number } = {}) {
    this.port = port;
    this.worldSeed = worldSeed;
    this.session = new GameSession({ worldSeed });
    this.world = this.session.world;
  }

  start() {
    if (this.http) return this.http;

    const http = createServer(handleHttp);
    const server = new WebSocketServer({
      noServer: true,
      maxPayload: 32 * 1024,
    });
    const alive = new WeakMap<object, boolean>();

    this.http = http;
    this.server = server;
    http.on('upgrade', (request, socket, head) => {
      const origin = request.headers.origin;
      const host = request.headers.host;
      const local =
        process.env.NODE_ENV !== 'production' &&
        (origin === 'http://localhost:3000' ||
          origin === 'http://127.0.0.1:3000');

      if (
        request.url !== '/game-socket' ||
        (origin && !local && origin !== `https://${host}`) ||
        server.clients.size >= 40
      ) {
        socket.destroy();
        return;
      }
      server.handleUpgrade(request, socket, head, (client) => {
        server.emit('connection', client, request);
      });
    });
    server.on('connection', (socket) => {
      alive.set(socket, true);
      let messages = 0;
      let greeted = false;
      let windowStarted = Date.now();
      const helloTimeout = setTimeout(
        () => socket.close(1008, 'Hello timeout'),
        10000,
      );

      socket.on('pong', () => alive.set(socket, true));
      socket.on('error', () => socket.terminate());
      socket.on('message', (data, isBinary) => {
        const now = Date.now();

        if (now - windowStarted >= 1000) {
          windowStarted = now;
          messages = 0;
        }

        if (isBinary || ++messages > 120) {
          socket.close(1008, 'Message limit');
          return;
        }
        const message = parseClientMessage(data);

        if (!message) {
          socket.close(1007, 'Invalid message');
          return;
        }

        if (message.type === 'hello') {
          if (greeted) {
            socket.close(1008, 'Already joined');
            return;
          }
          greeted = true;
          clearTimeout(helloTimeout);
        }
        this.session.receive({ message, socket });
      });
      socket.on('close', () => {
        clearTimeout(helloTimeout);
        this.session.disconnect({ socket });
      });
    });
    this.heartbeat = setInterval(() => {
      server.clients.forEach((socket) => {
        if (!alive.get(socket)) socket.terminate();
        else {
          alive.set(socket, false);
          socket.ping();
        }
      });
    }, 30000);
    http.listen(this.port, '0.0.0.0');

    const period = simulationStep * 1000;
    let nextTick = performance.now() + period;
    const tick = () => {
      this.session.tick();
      // Schedule against a deadline: repeating a rounded 33 ms interval runs
      // faster than 30 Hz and makes clients periodically jump a whole tick.
      // Drop old debt after a stall instead of scheduling an unbounded replay.
      nextTick = Math.max(nextTick + period, performance.now());
      this.timer = setTimeout(
        tick,
        Math.max(1, Math.ceil(nextTick - performance.now())),
      );
    };

    this.timer = setTimeout(tick, Math.ceil(period));
    return http;
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);

    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;

    const server = this.server;
    const http = this.http;

    this.server = undefined;
    this.http = undefined;

    if (!server || !http) return;

    server.clients.forEach((socket) => socket.close());
    const force = setTimeout(() => {
      server.clients.forEach((socket) => socket.terminate());
    }, 3000);

    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ]);
    clearTimeout(force);
  }
}
