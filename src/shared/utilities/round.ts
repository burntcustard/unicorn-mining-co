/**
 * Share a compact numeric precision across simulation and generated geometry.
 * This significantly reduces packet sizes between server and clients.
 */
export const round = (value: number) => Math.round(value * 1e8) / 1e8;
