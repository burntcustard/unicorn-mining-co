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
