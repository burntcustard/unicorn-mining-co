import { createPlayerShip } from '../../client/objects/create-ship';
import { ThrusterCrescent, thrusters } from '../../client/objects/modules';
import { type Module } from '../../client/objects/modules/module';
import { createWorld } from '../../client/simulation/world';
import { shipStats } from '../../client/ui/dom/ship-stats';
import { createComparisonMetric } from './comparison';

const comparisonThrusters = [
  ...thrusters.filter((Type) => Type !== ThrusterCrescent),
  ThrusterCrescent,
];

export const thrusterComparison = () => {
  const ship = createPlayerShip(createWorld());
  const mount = ship.mounts.find(
    ({ module }) => module && module.forwardThrust,
  );

  if (!mount) throw new Error('The Mustang has no fitted thruster');
  const stockType = mount.module?.constructor;

  ship.fit(0, mount);

  return comparisonThrusters.map((thruster) => {
    const Type = thruster as typeof Module;
    const { acceleration, maxSpeed, turnRate } = shipStats(ship, Type);

    return {
      Type,
      compatible: mount.fits.includes(Type),
      stock: Type === stockType,
      mass: Type.mass,
      price: Type.price,
      powerUse: Type.powerActivated ?? Type.power ?? 0,
      fuelUsage: Type.fuelUsage * 60,
      acceleration,
      maxSpeed,
      turnRate,
    };
  });
};

export const renderThrusterComparison = (container: HTMLElement) => {
  const rows = thrusterComparison();
  const metrics = [
    { key: 'mass', label: 'Mass', unit: 'kg' },
    { key: 'price', label: 'Price', unit: '' },
    { key: 'powerUse', label: 'Power use', unit: 'MW' },
    { key: 'fuelUsage', label: 'Fuel use', unit: 'L/min' },
    { key: 'maxSpeed', label: 'Max speed', unit: 'm/s' },
    { key: 'acceleration', label: 'Acceleration', unit: 'm/s²' },
    { key: 'turnRate', label: 'Turn rate', unit: '°/s' },
  ] as const;
  const maximum = metrics.map(({ key }) =>
    Math.max(...rows.map((row) => row[key])),
  );
  const heading = document.createElement('h2');
  const description = document.createElement('p');
  const wrapper = document.createElement('div');
  const table = document.createElement('table');
  const body = document.createElement('tbody');

  heading.textContent = 'Thruster comparison';
  description.className = 'module-comparison-description';
  description.textContent =
    'Full-power performance on a stock Mustang. Some thrusters cannot be fitted to the Mustang, so their performance figures are theoretical.';
  wrapper.className = 'module-comparison-scroll';
  table.className = 'module-comparison-table';
  table.innerHTML = `<caption class="module-comparison-caption">Thruster mass, price, power use, fuel usage, and Mustang performance</caption>
    <colgroup><col style="width: 1%"></colgroup>
    <thead><tr><th scope="col">Thruster</th>${metrics.map(({ label, unit }) => `<th scope="col">${label}${unit ? ` <span>${unit}</span>` : ''}</th>`).join('')}</tr></thead>`;

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const name = document.createElement('th');

    if (row.stock) tr.classList.add('module-comparison-stock');

    if (row.Type.definitionId === 'thrusterTriple') {
      tr.classList.add('module-comparison-triple');
    }

    name.scope = 'row';
    name.textContent = row.Type.name;
    tr.append(name);

    metrics.forEach(({ key }, index) => {
      tr.append(
        createComparisonMetric({
          value: row[key],
          maximum: maximum[index],
          decimals: key === 'powerUse' || key === 'fuelUsage' ? 1 : 0,
          useGrouping: key !== 'mass',
        }),
      );
    });

    body.append(tr);
  });

  table.append(body);
  wrapper.append(table);
  container.replaceChildren(heading, description, wrapper);
};
