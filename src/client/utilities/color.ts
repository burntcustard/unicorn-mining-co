/**
 * Apply numeric opacity to an opaque three- or six-digit hex colour.
 */
export const withAlpha = ({
  color,
  alpha = 1,
}: {
  color: string;
  alpha?: number;
}) =>
  alpha === 1
    ? color
    : `${color.length === 4 ? color.replace(/[\da-f]/gi, (digit) => digit + digit) : color}${Math.round(
        alpha * 255,
      )
        .toString(16)
        .padStart(2, '0')}`;
