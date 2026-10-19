/*
 * Ask the existing development proxy to inject transit time. Page timers stretch
 * with render stalls; worker-owned Firefox sockets introduce extra scheduling
 * delay. Keep the native browser socket and delay traffic in the Node proxy.
 */
export const inputResponseSetup = (delay: number) => `(() => {
  window.inputBenchmarkErrors = [];
  addEventListener('error', event => window.inputBenchmarkErrors.push(event.message));
  addEventListener('unhandledrejection', event => window.inputBenchmarkErrors.push(String(event.reason)));
  const NativeAudio = AudioContext;
  window.inputBenchmarkAudioSetup = [];
  window.AudioContext = class extends NativeAudio {
    constructor(...args) {
      const at = performance.timeOrigin + performance.now();
      super(...args);
      window.inputBenchmarkAudio = this;
      window.inputBenchmarkAudioSetup.push({at,completedAt:performance.timeOrigin + performance.now()});
    }
  };
  if (!${delay}) return;
  const NativeSocket = WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url, protocols) {
      const target = new URL(url, location.href);
      if (target.pathname === '/game-socket') target.searchParams.set('benchmark-delay', '${delay}');
      super(target.href, protocols);
    }
  };
})()`;
