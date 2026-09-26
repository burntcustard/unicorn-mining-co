import { WebSocketServer } from 'ws';
import { parseClientMessage } from './parse-client-message';
import { simulationStep } from '../shared/settings';
import { GameSession } from './game-session';

export class GameServer {
  readonly worldSeed: number;
  readonly world;
  private timer?: ReturnType<typeof setTimeout>;
  private port: number;
  private session: GameSession;
  private server?: WebSocketServer;

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
    if (this.server) return this.server;

    this.server = new WebSocketServer({ port: this.port });
    this.server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = parseClientMessage(data);

        if (!message) {
          socket.close(1007, 'Invalid message');
          return;
        }

        this.session.receive({ message, socket });
      });
      socket.on('close', () => this.session.disconnect({ socket }));
    });
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
    return this.server;
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;

    const server = this.server;

    this.server = undefined;

    if (!server) return;
    server.clients.forEach((socket) => socket.close());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
