// Fixed settings and execution order for comparable deployment captures.
export const liveSuite = {
  counts: [4, 8, 16, 32],
  workloads: ['convoy', 'spread', 'contact', 'module'],
  viewport: { width: 320, height: 200 },
  cooldownBetweenCounts: 120,
};

export async function runLiveSuite({
  runCase,
  cooldown,
  suite = liveSuite,
}: {
  runCase: (options: { players: number; workload: string }) => Promise<void>;
  cooldown: (options: {
    seconds: number;
    previousPlayers: number;
    nextPlayers: number;
  }) => Promise<void>;
  suite?: typeof liveSuite;
}) {
  for (const [index, players] of suite.counts.entries()) {
    if (index > 0) {
      await cooldown({
        seconds: suite.cooldownBetweenCounts,
        previousPlayers: suite.counts[index - 1],
        nextPlayers: players,
      });
    }

    for (const workload of suite.workloads) {
      await runCase({ players, workload });
    }
  }
}
