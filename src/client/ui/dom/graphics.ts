// Fixed positions also keep preferences stable across minified releases.
export const graphics: [boolean, boolean, boolean, number] = [
  true,
  true,
  true,
  1,
];

export const restoreGraphics = () => {
  try {
    const saved = JSON.parse(
      localStorage.getItem('unicorn-graphics') || 'null',
    );

    if (Array.isArray(saved)) {
      for (let i = 0; i < 3; i++) {
        if (typeof saved[i] === 'boolean') graphics[i] = saved[i];
      }

      // Resolution is last, including in older preferences with a glow toggle.
      const resolution = saved.at(-1);

      if ([0.5, 0.75, 1, 1.5, 2].includes(resolution)) graphics[3] = resolution;
    }
  } catch {
    /* Storage may be unavailable; defaults still work. */
  }
};

restoreGraphics();

export const saveGraphics = () => {
  try {
    localStorage.setItem('unicorn-graphics', JSON.stringify(graphics));
  } catch {
    /* Apply for this visit. */
  }

  window.dispatchEvent(new Event('ui-graphics'));
};
