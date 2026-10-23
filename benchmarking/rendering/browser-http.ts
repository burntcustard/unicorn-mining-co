/*
 * Include response decoding in the request deadline so a browser that accepts
 * a connection but stops sending cannot prevent cancellation and cleanup.
 */
export const readBrowserJson = async ({
  url,
  signal,
  timeoutMs = 1000,
}: {
  url: string;
  signal: AbortSignal;
  timeoutMs?: number;
}) => {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });

  return response.json();
};
