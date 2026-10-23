/*
 * Only grant access to the selected local game endpoint, in the benchmark's
 * temporary browser context. Public live origins need no local-network grant.
 */
export function latencyNetworkPermission(url: string) {
  const hostname = new URL(url).hostname;
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    (ipv4 && hostname.startsWith('127.'))
  ) {
    return 'loopback-network';
  }

  if (
    (ipv4 &&
      /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        hostname,
      )) ||
    hostname.endsWith('.local') ||
    /^\[(?:f[cd]|fe[89ab])/i.test(hostname)
  ) {
    return 'local-network';
  }

  return null;
}
