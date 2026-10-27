import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readBrowserJson } from '../../benchmarking/utilities/browser-http.ts';

let requests = 0;

const server = createServer((request, response) => {
  requests++;

  if (request.url === '/json') {
    response.end(JSON.stringify([{ webSocketDebuggerUrl: 'ws://owned/page' }]));
  } else if (request.url === '/json/version') {
    response.end(
      JSON.stringify({ webSocketDebuggerUrl: 'ws://owned/browser' }),
    );
  } else if (request.url === '/pending-body') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{');
  }
  // Other requests deliberately keep the connection open without headers.
});

try {
  const listening = once(server, 'listening');

  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();

  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();

  assert.deepEqual(
    await readBrowserJson({ url: `${origin}/json`, signal: controller.signal }),
    [{ webSocketDebuggerUrl: 'ws://owned/page' }],
  );

  assert.deepEqual(
    await readBrowserJson({
      url: `${origin}/json/version`,
      signal: controller.signal,
    }),
    { webSocketDebuggerUrl: 'ws://owned/browser' },
  );

  for (const path of ['/pending-headers', '/pending-body']) {
    const began = performance.now();

    await assert.rejects(
      readBrowserJson({
        url: `${origin}${path}`,
        signal: controller.signal,
        timeoutMs: 40,
      }),
      { name: 'TimeoutError' },
    );

    assert(performance.now() - began < 2000, 'A stalled response is bounded');

    const cancellation = new AbortController();

    const requested = once(server, 'request', {
      signal: AbortSignal.timeout(2000),
    });

    const reason = new Error('Rendering capture interrupted');

    const pending = assert.rejects(
      readBrowserJson({
        url: `${origin}${path}`,
        signal: cancellation.signal,
        timeoutMs: 2000,
      }),
      (error) => error === reason,
    );

    await requested;
    cancellation.abort(reason);
    await pending;
  }

  const previousRequests = requests;
  const cancelled = new AbortController();

  cancelled.abort(new Error('Already cancelled'));
  await assert.rejects(
    readBrowserJson({ url: `${origin}/json`, signal: cancelled.signal }),
    /Already cancelled/,
  );
  assert.equal(
    requests,
    previousRequests,
    'Cancellation prevents new requests',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
