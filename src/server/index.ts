import { GameServer } from './game-server';

const argumentPort = process.argv.find(
  (argument, index) => argument === '--port' && process.argv[index + 1],
);
const port = Number(
  (argumentPort && process.argv[process.argv.indexOf(argumentPort) + 1]) ||
    process.env.PORT ||
    3001,
);
const server = new GameServer({
  port,
  worldSeed: Number(process.env.WORLD_SEED || 25),
});

server
  .start()
  .on('listening', () =>
    console.log(`Game server listening on http://0.0.0.0:${port}`),
  );

const stop = async () => {
  await server.stop();
  process.exit();
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
