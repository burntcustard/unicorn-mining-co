const litTint = 0.32;
const warmTint = 0.2;
const shadeTint = 0.2;

const parse = (c) => [1, 2, 3].map((i) => parseInt(c[i], 16) * 17);
const hex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (f, t, a) => f.map((w, i) => w + (t[i] - w) * a);
const white = parse('#fff');

// base, shadow, light
const candidates = {
  red:    ['#f33', '#616', '#fca'],
  orange: ['#fa3', '#714', '#fe9'],
  yellow: ['#fe4', '#741', '#ffb'],
  green:  ['#3f7', '#164', '#ef9'],
  cyan:   ['#4df', '#148', '#cff'],
  indigo: ['#55f', '#217', '#bdf'],
  violet: ['#e6f', '#427', '#fdf'],
  pink:   ['#f8d', '#729', '#fef'],
  white:  ['#fff', '#33c', '#f8d'],
};

Object.entries(candidates).forEach(([name, [base, shadow, light]]) => {
  const b = parse(base);
  const lit = hex(mix(mix(b, white, litTint), parse(light), warmTint));
  const dark = hex(mix(b, parse(shadow), shadeTint));

  console.log(name.padEnd(7), 'dark', dark, ' base', hex(b), ' lit', lit);
});
