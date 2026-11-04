import { type SimulationWorld } from '../../simulation/world';
import { type GameObject } from '../../objects/game-object';
import { type Pose } from '../../types';
import { simulationStep } from '../../../specs/simulation';

/**
 * Keep fixed-tick simulation values separate from rendered poses. Tick/time
 * identify world data; presentation describes the most recently drawn frame.
 */
export const createTelemetry = ({
  element,
  readSample,
}: {
  element: HTMLElement;
  readSample: () => {
    world: SimulationWorld;
    shipId?: number;
    targetId?: number;
    connected: boolean;
    snapshotReceivedAt: number;
  };
}) => {
  const panel = document.createElement('div');

  panel.className = 'hud-telemetry ui-card grid gap-2 p-3';
  panel.hidden = true;

  const section = (title: string, className: string) => {
    const element = document.createElement('div');
    const heading = document.createElement('strong');

    element.className = `${className} grid gap-2`;
    heading.textContent = title;
    element.append(heading);
    return element;
  };

  const simulation = section('Simulation', 'telemetry-simulation');
  const rendered = section('Rendered', 'telemetry-rendered');
  const header = document.createElement('div');
  const frame = document.createElement('div');

  header.className = 'telemetry-clock';
  frame.className = 'telemetry-frame';
  simulation.append(header);
  rendered.append(frame);
  rendered.hidden = true;
  panel.append(simulation, rendered);
  element.append(panel);
  let nextUpdate = 0;

  const number = (value: number) => value.toFixed(3);

  const lines = (text: string) =>
    text.split('\n').map((text) => {
      const line = document.createElement('div');

      line.textContent = text;
      return line;
    });

  const update = ({
    now,
    readPresentation,
  }: {
    now: number;
    readPresentation?: () => {
      frameTime: number;
      renderTime: number;
      canvas: HTMLCanvasElement;
      transform: DOMMatrix;
      playerPose?: Pose;
      targetPose?: Pose;
    };
  }) => {
    if (panel.hidden || now < nextUpdate) return;
    nextUpdate = now + 100;
    const { world, shipId, targetId, connected, snapshotReceivedAt } =
      readSample();
    const age = snapshotReceivedAt
      ? Math.max(0, now - snapshotReceivedAt)
      : undefined;

    const presentation = readPresentation?.();

    header.replaceChildren(
      ...lines(
        `Simulation tick ${world.tick}\nSimulation time ${Math.round(world.tick * simulationStep)} s\nSnapshot age ${age === undefined ? 'unavailable' : `${Math.round(age)} ms`}`,
      ),
    );

    const entity = (id?: number) => {
      const object =
        connected && id !== undefined ? world.entities.get(id) : undefined;

      return object && !object.dead ? object : undefined;
    };

    const player = entity(shipId);
    const target = entity(targetId);
    const parents = new Map<number, GameObject>();
    const rows: HTMLElement[] = [];
    const renderedRows: HTMLElement[] = [];

    const record = (role: string, object?: GameObject) => {
      const row = document.createElement('div');

      row.className = `telemetry-${role.toLowerCase()}`;
      rows.push(row);

      if (!object) {
        row.textContent = `${role}: unavailable`;
        return;
      }

      const { id, position, rotation, velocity, spin, localMovementRate } =
        object;
      const parent =
        object.localMovementParent && entity(object.localMovementParent.id);

      row.append(
        ...lines(
          `${role} #${id}\nPos ${number(position.x)}/${number(position.y)}\nRotation ${number(rotation)} rad\nNative velocity ${number(velocity.x)}/${number(velocity.y)} m/s\nNative spin ${number(spin)} rad/s`,
        ),
      );

      if (
        parent &&
        localMovementRate !== undefined &&
        localMovementRate > 0 &&
        role !== 'Parent'
      ) {
        row.append(
          ...lines(
            `Carrier #${parent.id}\nlocalMovementRate ${number(localMovementRate)}`,
          ),
        );

        if (parent !== player && parent !== target) {
          parents.set(parent.id, parent);
        }
      }
    };

    record('Player', player);

    if (targetId !== undefined) record('Target', target);
    parents.forEach((parent) => record('Parent', parent));

    if (presentation) {
      const { canvas, transform } = presentation;
      const bounds = canvas.getBoundingClientRect();
      const pixelsX = bounds.width / canvas.width;
      const pixelsY = bounds.height / canvas.height;
      const scaleX = transform.a * pixelsX;
      const scaleY = transform.d * pixelsY;
      const offsetX = bounds.left + transform.e * pixelsX;
      const offsetY = bounds.top + transform.f * pixelsY;

      frame.replaceChildren(
        ...lines(
          `Frame time ${presentation.frameTime} ms\nRender time (CPU) ${presentation.renderTime} ms\nScale ${scaleX.toFixed(6)} px/m\nOffset pos ${number(offsetX)}/${number(offsetY)} px`,
        ),
      );

      for (const [role, object, pose] of [
        ['Player', player, presentation.playerPose],
        ['Target', target, presentation.targetPose],
      ] as const) {
        if (!object || !pose) continue;
        const row = document.createElement('div');

        row.className = `telemetry-${role.toLowerCase()}`;
        row.append(
          ...lines(
            `${role} #${object.id}\nPos ${number(pose.position.x)}/${number(pose.position.y)}\nRotation ${number(pose.rotation)} rad\nScreen pos ${number(pose.position.x * scaleX + offsetX)}/${number(pose.position.y * scaleY + offsetY)} px`,
          ),
        );
        renderedRows.push(row);
      }
    } else {
      frame.replaceChildren();
    }

    simulation.replaceChildren(simulation.firstElementChild!, header, ...rows);
    rendered.replaceChildren(
      rendered.firstElementChild!,
      frame,
      ...renderedRows,
    );
    rendered.hidden = !presentation;
  };

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      nextUpdate = 0;
    },
    update,
  };
};
