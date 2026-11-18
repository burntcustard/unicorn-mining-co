import { createPlayerShip } from '../../client/objects/create-ship';
import { thrusters } from '../../client/objects/modules';
import { type Module } from '../../client/objects/modules/module';
import { createWorld } from '../../client/simulation/world';
import { shipStats } from '../../client/ui/dom/ship-stats';
import { createComparisonMetric } from './comparison';

export const thrusterComparison = () => {
  const ship = createPlayerShip(createWorld());
  const mount = ship.mounts.find(
    ({ module }) => module && module.forwardThrust,
  );

  if (!mount) throw new Error('The Mustang has no fitted thruster');
  const stockType = mount.module?.constructor;

  ship.fit(0, mount);

  return thrusters.map((thruster) => {
    const Type = thruster as typeof Module;
    const { acceleration, maxSpeed, turnRate } = shipStats(ship, Type);

    return {
      Type,
      compatible: mount.fits.includes(Type),
      stock: Type === stockType,
      mass: Type.mass,
      price: Type.price,
      acceleration,
      maxSpeed,
      turnRate,
    };
  });
};

export const renderThrusterComparison = (container: HTMLElement) => {
  const rows = thrusterComparison();
  const metrics = [
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
  const notes = document.createElement('p');

  heading.textContent = 'Thruster comparison';
  description.className = 'module-comparison-description';
  description.textContent =
    'Full-power performance on an otherwise stock Mustang.';
  wrapper.className = 'module-comparison-scroll';
  table.className = 'module-comparison-table';
  table.innerHTML = `<caption class="module-comparison-caption">Thruster mass, price, and Mustang performance</caption>
    <thead><tr><th scope="col">Thruster</th><th scope="col">Mass</th><th scope="col">Price</th><th scope="col">Max speed <span>m/s</span></th><th scope="col">Acceleration <span>m/s²</span></th><th scope="col">Turn rate <span>°/s</span></th></tr></thead>`;

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const name = document.createElement('th');
    const mass = document.createElement('td');
    const price = document.createElement('td');

    tr.className = row.stock
      ? 'module-comparison-stock'
      : row.compatible
        ? ''
        : 'module-comparison-incompatible';

    if (row.Type.definitionId === 'thrusterTriple') {
      tr.classList.add('module-comparison-triple');
    }

    name.scope = 'row';
    name.textContent = `${row.Type.name}${row.stock ? ' (stock)' : ''}${row.compatible ? '' : ' *'}`;
    mass.textContent = `${row.mass.toLocaleString('en-US')} kg`;
    price.textContent = row.price.toLocaleString('en-US');
    tr.append(name, mass, price);

    metrics.forEach(({ key }, index) => {
      tr.append(
        createComparisonMetric({ value: row[key], maximum: maximum[index] }),
      );
    });

    body.append(tr);
  });

  table.append(body);
  wrapper.append(table);
  notes.className = 'module-comparison-notes';
  notes.textContent =
    '* Does not fit the Mustang; its performance is hypothetical. Prices are in unicredits. The stock power plant cannot continuously supply some thrusters at full power.';
  container.replaceChildren(heading, description, wrapper, notes);
};
