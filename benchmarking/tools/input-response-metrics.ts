/*
 * Use the last completed frame before the actual DOM input event as the
 * baseline. Interpolating across the event includes part of the response in
 * that baseline; rAF timestamps also precede the work that draws the frame.
 */
export const firstMotionResponse = ({
  frames,
  edgeAt,
}: {
  frames: { completedAt: number; rotation: number }[];
  edgeAt: number;
}) => {
  const baseline = frames.findLast((frame) => frame.completedAt < edgeAt);

  if (!baseline) throw new Error('Missing pre-input frame');

  const response = frames.find((frame) => {
    const angle = frame.rotation - baseline.rotation;

    return (
      frame.completedAt >= edgeAt &&
      Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) > 0.0001
    );
  });

  if (!response) throw new Error('Missing motion response');
  return response.completedAt - edgeAt;
};

export type ResponseFrame = {
  completedAt: number;
  rotation: number;
  spin: number;
  projectileDraws: { id: number; at: number; inView?: boolean }[];
  muzzleDraws?: {
    at: number;
    trialId: number;
    createdAt?: number;
    inView?: boolean;
    alpha?: number;
  }[];
};

type Onset = { ms: number | null; reason: string | null };

const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

/*
 * Repeated onset trials need a neutral baseline. Continued rotation before a
 * reversal is already visible and must not count as a response to the new key.
 */
export const stationaryBaseline = ({
  frames,
  edgeAt,
}: {
  frames: ResponseFrame[];
  edgeAt: number;
}) => {
  const previous = frames
    .filter((frame) => frame.completedAt < edgeAt)
    .slice(-3);

  return (
    previous.length === 3 &&
    previous.every((frame) => Math.abs(frame.spin) <= 0.005) &&
    previous.every(
      (frame) =>
        Math.abs(angle(frame.rotation - previous[0].rotation)) <= 0.0001,
    )
  );
};

/*
 * Report failed baselines and missing responses explicitly. Callers retain
 * those trials in the denominator instead of silently selecting fast trials.
 */
export const steeringOnset = ({
  frames,
  edgeAt,
  direction,
  endAt,
}: {
  frames: ResponseFrame[];
  edgeAt: number;
  direction: number;
  endAt: number;
}): Onset => {
  if (!stationaryBaseline({ frames, edgeAt })) {
    return { ms: null, reason: 'nonstationary-or-missing-baseline' };
  }

  const baseline = frames.findLast((frame) => frame.completedAt < edgeAt)!;
  const response = frames.find(
    (frame) =>
      frame.completedAt >= edgeAt &&
      frame.completedAt <= endAt &&
      direction * angle(frame.rotation - baseline.rotation) > 0.0001,
  );

  return response
    ? { ms: response.completedAt - edgeAt, reason: null }
    : { ms: null, reason: 'no-steering-draw' };
};

/*
 * A predicted entity is not necessarily drawn by the game. Count a new owned
 * projectile only after its real render method ran and that frame completed.
 */
export const projectileOnset = ({
  frames,
  edgeAt,
  endAt,
  previousIds,
  births,
}: {
  frames: ResponseFrame[];
  edgeAt: number;
  endAt: number;
  previousIds: number[];
  births?: { id: number; at: number }[];
}): Onset => {
  const previous = new Set(previousIds);
  const response = frames.find(
    (frame) =>
      frame.completedAt >= edgeAt &&
      frame.completedAt <= endAt &&
      frame.projectileDraws.some(
        (draw) =>
          draw.at >= edgeAt &&
          draw.inView !== false &&
          (births
            ? births.some(
                (birth) =>
                  birth.id === draw.id &&
                  birth.at >= edgeAt &&
                  birth.at <= draw.at,
              )
            : !previous.has(draw.id)),
      ),
  );

  return response
    ? { ms: response.completedAt - edgeAt, reason: null }
    : { ms: null, reason: 'no-projectile-draw' };
};

/*
 * Flash creation is separate from its visible draw. Effects with delayed or
 * transparent parts cannot respond until an actual nontransparent draw runs.
 */
export const muzzleOnset = ({
  frames,
  edgeAt,
  endAt,
  trialId,
}: {
  frames: ResponseFrame[];
  edgeAt: number;
  endAt: number;
  trialId: number;
}): Onset => {
  const response = frames.find(
    (frame) =>
      frame.completedAt >= edgeAt &&
      frame.completedAt <= endAt &&
      frame.muzzleDraws?.some(
        (draw) =>
          draw.at >= edgeAt &&
          (draw.createdAt ?? draw.at) >= edgeAt &&
          draw.trialId === trialId &&
          draw.inView !== false &&
          (draw.alpha === undefined || draw.alpha > 0),
      ),
  );

  return response
    ? { ms: response.completedAt - edgeAt, reason: null }
    : { ms: null, reason: 'no-muzzle-draw' };
};
