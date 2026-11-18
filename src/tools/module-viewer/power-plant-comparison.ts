import { moduleTypesById } from '../../client/objects/modules';
import { powerPlantIdsBySize } from '../../specs/modules';
import { createComparisonMetric } from './comparison';

export const powerPlantComparison = () =>
  Object.values(powerPlantIdsBySize).flatMap((ids) =>
    ids
      .map((id) => moduleTypesById.get(id)!)
      .sort((a, b) => a.powerGenerated - b.powerGenerated)
      .map((Type) => ({
        Type,
        mass: Type.mass,
        price: Type.price,
        powerGenerated: Type.powerGenerated,
        powerCapacity: Type.powerCapacity,
      })),
  );

export const renderPowerPlantComparison = (container: HTMLElement) => {
  const rows = powerPlantComparison();
  const maximumMass = Math.max(...rows.map((row) => row.mass));
  const maximumGeneration = Math.max(...rows.map((row) => row.powerGenerated));
  const maximumCapacity = Math.max(...rows.map((row) => row.powerCapacity));
  const heading = document.createElement('h2');
  const wrapper = document.createElement('div');
  const table = document.createElement('table');
  const body = document.createElement('tbody');

  heading.textContent = 'Power plant comparison';
  wrapper.className = 'module-comparison-scroll';
  table.className = 'module-comparison-table';
  table.style.minWidth = '54rem';
  table.style.tableLayout = 'fixed';
  table.innerHTML = `<caption class="module-comparison-caption">Power plant price, mass, generation, and storage</caption>
    <colgroup><col style="width: 14rem"><col style="width: 7rem"><col span="3"></colgroup>
    <thead><tr><th scope="col">Power plant</th><th scope="col">Price</th><th scope="col">Mass <span>kg</span></th><th scope="col">Generation <span>MW</span></th><th scope="col">Storage <span>MJ</span></th></tr></thead>`;

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const name = document.createElement('th');
    const price = document.createElement('td');

    name.scope = 'row';
    name.textContent = row.Type.name;
    price.textContent = `${row.price.toLocaleString('en-US')}$`;

    tr.append(
      name,
      price,
      createComparisonMetric({ value: row.mass, maximum: maximumMass }),
      createComparisonMetric({
        value: row.powerGenerated,
        maximum: maximumGeneration,
        decimals: 1,
      }),
      createComparisonMetric({
        value: row.powerCapacity,
        maximum: maximumCapacity,
      }),
    );

    body.append(tr);
  });

  table.append(body);
  wrapper.append(table);
  container.replaceChildren(heading, wrapper);
};
