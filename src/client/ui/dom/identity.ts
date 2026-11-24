// Tuples form the HTTP contract so production property mangling cannot change it.
export type ShipPreview = [
  string,
  number,
  number[],
  [number, number, number, number | null][],
];
export type Identity = [string, number, ShipPreview];

// Keep existing browser saves and accounts accessible across client versions.
export const playerIdStorageKey = 'playerToken';

const isPlayerId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const verifyIdentity = async (
  playerId: string,
  signal: AbortSignal,
): Promise<Identity> => {
  if (!isPlayerId(playerId)) {
    throw new Error(
      'Enter a valid private ID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
    );
  }

  const response = await fetch('/api/identity', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: playerId,
    signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'No player was found for that ID.'
        : 'The server could not verify this ID. Please try again.',
    );
  }

  return response.json();
};
