export type NumberParameter = {
  label: string;
  min: number;
  max: number;
  step: number;
  inputStep?: number;
  scale?: 'log';
  unit?: string;
  integer?: boolean;
};

let nextControlId = 0;

/**
 * Pair a precise number field with a slider, including zero-safe log scaling.
 */
export const numberControl = ({
  parameter,
  value,
  change,
}: {
  parameter: NumberParameter;
  value: number;
  change: (value: number) => void;
}) => {
  const { label: text, min, max, step, scale, unit, integer } = parameter;
  const id = `number-control-${nextControlId++}`;
  const control = document.createElement('div');
  const label = document.createElement('label');
  const number = document.createElement('input');
  const slider = document.createElement('input');
  const bounds = document.createElement('small');
  const offset = Math.max(min, step);
  const toPosition = (value: number) =>
    scale === 'log'
      ? Math.log1p((value - min) / offset) / Math.log1p((max - min) / offset)
      : (value - min) / (max - min);
  const fromPosition = (position: number) =>
    scale === 'log'
      ? min + offset * Math.expm1(position * Math.log1p((max - min) / offset))
      : min + position * (max - min);

  control.className = 'number-control';
  label.textContent = `${text}${unit ? ` (${unit})` : ''}`;
  label.setAttribute('id', `${id}-label`);
  label.setAttribute('for', id);
  number.setAttribute('id', id);
  number.type = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = String(parameter.inputStep ?? (integer ? step : 'any'));
  number.value = String(value);
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.value = String(toPosition(value));
  slider.setAttribute('aria-labelledby', `${id}-label`);
  slider.setAttribute('aria-valuetext', String(value));
  bounds.textContent = `${min}-${max}, ${scale === 'log' ? 'logarithmic' : 'linear'}`;
  bounds.className = 'text-muted';

  const setValue = (value: number) => {
    number.value = String(value);
    number.setCustomValidity('');
    number.setAttribute('aria-invalid', 'false');
    slider.value = String(toPosition(value));
    slider.setAttribute('aria-valuetext', String(value));
  };

  number.addEventListener('input', () => {
    const raw = number.valueAsNumber;
    const value = integer ? Math.round(raw) : raw;
    const valid = Number.isFinite(raw) && raw >= min && raw <= max;

    number.setAttribute('aria-invalid', String(!valid));
    number.setCustomValidity(
      valid ? '' : `Enter a number from ${min} to ${max}.`,
    );

    if (!valid) return;
    number.value = String(value);
    slider.value = String(toPosition(value));
    slider.setAttribute('aria-valuetext', String(value));
    change(value);
  });

  slider.addEventListener('input', () => {
    const unrounded = fromPosition(slider.valueAsNumber);
    const value = Math.min(
      max,
      Math.max(
        min,
        Number((Math.round(unrounded / step) * step).toPrecision(10)),
      ),
    );

    setValue(value);
    change(value);
  });

  control.append(label, bounds, slider, number);
  return { element: control, setValue };
};
