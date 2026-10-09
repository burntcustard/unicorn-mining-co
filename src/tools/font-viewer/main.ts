import '../style.css';
import { createSpecimens } from './specimen';

const preview = document.querySelector('main')!;
const specimens = [
  ...document.querySelectorAll<HTMLParagraphElement>('.specimen'),
];
const status = document.querySelector('#status')!;
const sizeValue = document.querySelector('#size-value')!;
const outlineOpacity =
  document.querySelector<HTMLInputElement>('#outline-opacity')!;
const outlineOpacityValue = document.querySelector('#outline-opacity-value')!;
const inputs = [
  ...document.querySelectorAll<HTMLInputElement>(
    'input:not([type="checkbox"])',
  ),
];

const updateControls = () => {
  for (const input of inputs) {
    preview.style.setProperty(
      `--${input.id}`,
      input === outlineOpacity
        ? String(input.valueAsNumber / 15)
        : input.value + (input.id === 'size' ? 'rem' : ''),
    );
  }

  sizeValue.textContent = `${inputs.find((input) => input.id === 'size')!.value}rem`;
  const opacity = outlineOpacity.valueAsNumber;

  outlineOpacityValue.textContent = `${Math.round((opacity / 15) * 1000) / 10}% [${opacity.toString(16)}]`;
  outlineOpacity.setAttribute(
    'aria-valuetext',
    outlineOpacityValue.textContent,
  );
};

for (const input of inputs) input.addEventListener('input', updateControls);
updateControls();

let activeFont: FontFace | undefined;
let newestRevision = 0;

const updateFont = async (metadata: {
  characters: string[];
  bytes: number;
  revision: number;
}) => {
  if (metadata.revision < newestRevision) return;
  newestRevision = metadata.revision;

  try {
    const face = await new FontFace(
      `Gemetric-${metadata.revision}`,
      `url('/gemetric.woff2?v=${metadata.revision}')`,
    ).load();

    if (metadata.revision !== newestRevision) return;
    document.fonts.add(face);
    const samples = createSpecimens(metadata.characters);

    for (const specimen of specimens) {
      specimen.style.fontFamily = `"${face.family}", monospace`;
      specimen.textContent = samples[specimen.id as keyof typeof samples];
    }

    if (activeFont) document.fonts.delete(activeFont);
    activeFont = face;
    status.textContent = `${metadata.characters.length} glyphs · ${metadata.bytes.toLocaleString()} bytes (${(metadata.bytes / 1024).toFixed(2)} KiB)`;
  } catch (error) {
    status.textContent = `Font preview failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`;
  }
};

import.meta.hot?.on('gemetric:updated', updateFont);

import.meta.hot?.on('gemetric:error', (error: string) => {
  status.textContent = `Generation failed; showing the last valid font. ${error}`;
});

try {
  await updateFont(await (await fetch('/gemetric.json')).json());
} catch (error) {
  status.textContent = `Font preview failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`;
}
