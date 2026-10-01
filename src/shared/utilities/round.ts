/**
 * Share a compact numeric precision across simulation and generated geometry.
 * This significantly reduces packet sizes between server and clients.
 */
export const round = (value: number) => Math.round(value * 1e8) / 1e8;

/**
 * Motion uses the same half-up rule in Go and client prediction.
 */
export const roundMotion = (value: number) =>
  Math.floor(value * 1e8 + 0.5) / 1e8;
