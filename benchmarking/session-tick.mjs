/*
 * Times GameSession.tick() with players parked at real world coordinates, to
 * see where the 30 Hz server budget (33.3 ms) actually goes.
 */
import { rolldown } from 'rolldown';
import { rm, writeFile } from 'node:fs/promises';

const bundle = await rolldown({
  input: 'session-entry',
  external: ['node:crypto', 'ws'],
  plugins: [
    {
      name: 'session-entry',
      resolveId: (id) => (id === 'session-entry' ? '\0session-entry' : undefined),
      load: (id) =>
        id === '\0session-entry'
          ? `
            export { GameSession } from '${process.cwd()}/src/server/game-session.ts';
            export * as Vec from '${process.cwd()}/src/shared/vector.ts';
          `
          : undefined,
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();

const entry = `${process.cwd()}/benchmarking/.session-tick-bundle.mjs`;

await writeFile(entry, output[0].code);
const { GameSession, Vec } = await import(`file://${entry}`);

await rm(entry);

const places = [
  { name: 'spawn', position: Vec.create(-7388, -4398) },
  { name: 'north field', position: Vec.create(-8650, -19969) },
];

for (const playerCount of [1, 3]) {
  for (const { name, position } of places) {
    const session = new GameSession({ worldSeed: 25 });
    const sockets = [];

    for (let i = 0; i < playerCount; i++) {
      const socket = { readyState: 1, bufferedAmount: 0, send() {}, close() {} };

      sockets.push(socket);
      session.receive({ message: { type: 'hello', playerToken: null }, socket });
    }
    session.players ??= undefined;
    [...session['players'].values()].forEach((player, index) => {
      Vec.setXY(
        player.ship.position,
        position.x + index * 200,
        position.y + index * 200,
      );
    });

    for (let i = 0; i < 60; i++) session.tick();
    const samples = [];

    for (let i = 0; i < 300; i++) {
      const start = performance.now();

      session.tick();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        place: name,
        players: playerCount,
        entities: session.world.entities.size,
        medianMs: +samples[150].toFixed(2),
        p95Ms: +samples[285].toFixed(2),
        worstMs: +samples.at(-1).toFixed(2),
        budgetMs: 33.3,
      }),
    );
  }
}
