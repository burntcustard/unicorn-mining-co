import './comparison.css';

export const createComparisonMetric = ({
  value,
  maximum,
  decimals = 0,
  useGrouping = true,
}: {
  value: number;
  maximum: number;
  decimals?: number;
  useGrouping?: boolean;
}) => {
  const cell = document.createElement('td');
  const chart = document.createElement('div');
  const track = document.createElement('span');
  const bar = document.createElement('span');
  const label = document.createElement('span');

  chart.className = 'module-comparison-metric';
  track.className = 'module-comparison-track';
  bar.className = 'module-comparison-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.style.width = `${(value / maximum) * 100}%`;
  label.className = 'module-comparison-value';

  label.textContent = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping,
  });

  track.append(bar);
  chart.append(track, label);
  cell.append(chart);
  return cell;
};
