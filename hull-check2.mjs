import { colors } from './src/colors.js';

const mix = (from, to, amount) => `#${[1, 2, 3].map((i) => {
  const start = parseInt(from[i], 16);

  return Math.round(start + (parseInt(to[i], 16) - start) * amount).toString(16);
}).join('')}`;

const litTint = 0.32;
const shadeTint = 0.22;
const litColor = colors.pink[2];
const shadeColor = colors.indigo[0];
const bleachAt = 0.45;
const contrast = 0.8;
const spread = 0.2;

const shadeOf = (color) => (along) => {
  const at = Math.min(1, Math.max(0, along));
  const towards = (at - 0.5) * 2;

  if (towards > 0) return mix(color, shadeColor, towards * shadeTint);

  const warm = mix(color, litColor, -towards * litTint);

  return mix(warm, colors.white[2], Math.max(0, -towards - bleachAt) / (1 - bleachAt));
};

[['white hull', colors.white[1]], ['violet part', colors.violet[1]]].forEach(([label, paint]) => {
  const shade = shadeOf(paint);

  console.log(`\n${label}, base ${paint}`);

  [0, 0.25, 0.5, 0.75, 1].forEach((facing) => {
    const along = 0.5 + (facing - 0.5) * contrast;

    console.log(
      `  facing ${facing} -> stops`, shade(along - spread), shade(along + spread),
    );
  });
});
