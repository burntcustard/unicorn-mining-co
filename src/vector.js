export const dir = (vec) => Math.atan2(vec.y, vec.x);

export const magnitude = (vec) => Math.sqrt(vec.x * vec.x + vec.y * vec.y);

export const normalize = (vec) => {
  const mag = magnitude(vec);
  return { x: vec.x / mag, y: vec.y / mag };
};

export const multiply = (vec, val) => ({
  x: vec * val,
  y: vec * val,
});

export const dotProduct = (vec1, vec2) => vec1.x * vec2.x + vec1.y * vec2.y;
