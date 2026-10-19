// Development runners must enter the world before capturing simulation objects.
export const startBrowserGameplay = `(async () => {
  window.loadedGameModule = name => import(
    performance.getEntriesByType('resource').find(entry =>
      new URL(entry.name).pathname.endsWith('/src/client/' + name)
    )?.name || '/src/client/' + name
  );
  const { default: gameplay } = await window.loadedGameModule('gameplay.ts');
  const { network } = await window.loadedGameModule('network/network.ts');
  await network.authenticated;
  if (!network.displayName) await network.createProfile('Benchmark pilot');
  await gameplay.start();
  const { ui } = await window.loadedGameModule('ui/dom/ui.ts');
  const { player } = await window.loadedGameModule('player.ts');
  const { playerInput } = await window.loadedGameModule('input/input.ts');
  ui.clear();
  const started = performance.now();
  while (player.ship.dockedTo || player.ship.launching) {
    if (performance.now() - started > 15000) throw Error('Benchmark launch timed out');
    playerInput.launch = Boolean(player.ship.dockedTo);
    network.recordInput({ input: playerInput });
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  playerInput.launch = false;
  network.recordInput({ input: playerInput });
  return network.shipId;
})()`;

/**
 * Enter a deployed game through its normal menu without importing local code.
 */
export function advanceBenchmarkMenu() {
  const input = document.querySelector<HTMLInputElement>('#profile-name');

  if (input) {
    if (!input.readOnly) {
      input.value = 'Benchmark pilot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.requestSubmit();
    }

    return;
  }

  const play = document.querySelector<HTMLButtonElement>(
    '[data-action="play"]',
  );

  if (play && !play.disabled && play.getClientRects().length) {
    const data = document.documentElement.dataset;

    data.benchmarkPlayAttempts = String(
      Number(data.benchmarkPlayAttempts || 0) + 1,
    );
    play.click();
  }
}
