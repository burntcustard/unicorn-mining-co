// Direction of the ambient light used to shade craft, in radians.
export const lightAngle = -Math.PI / 4;

// How much the shading varies across each hull segment.
export const spread = 0.2;

// Strength of the white mixed into the lit side of painted hull segments.
export const litTint = 0.32;

// Strength of the paint's highlight color on the lit side of hull segments.
export const warmTint = 0.2;

// Strength of the paint's shadow color on the shaded side of hull segments.
export const shadeTint = 0.2;

// Blur amount for search light and docking bay glows, in screen pixels.
export const glowBlur = 40;

// Strength of the extra light where search light beams overlap.
export const beamOverlap = 0.5;
