import { type SimulationWorld } from '../../simulation/world';
import { type GameObject } from '../../objects/game-object';
import { simulationStep } from '../../../specs/simulation';

/**
 * Read only fixed-tick simulation objects. Render poses and fractional frame
 * prediction deliberately never enter this view. Tick/time identify the data,
 * even when the panel refreshes during a stalled or disconnected simulation.
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
  const header = document.createElement('div');

  panel.append(header);
  element.append(panel);
  let enabled = false;
  let nextUpdate = 0;

  const number = (value: number) => value.toFixed(3);

  const lines = (text: string) =>
    text.split('\n').map((text) => {
      const line = document.createElement('div');

      line.textContent = text;
      return line;
    });

  const update = ({ now }: { now: number }) => {
    if (!enabled || now < nextUpdate) return;
    nextUpdate = now + 100;
    const { world, shipId, targetId, connected, snapshotReceivedAt } =
      readSample();
    const age = snapshotReceivedAt
      ? Math.max(0, now - snapshotReceivedAt)
      : undefined;

    header.replaceChildren(
      ...lines(
        `Simulation tick ${world.tick}\nSimulation time ${Math.round(world.tick * simulationStep)} s\nSnapshot age: ${age === undefined ? 'unavailable' : `${Math.round(age)} ms`}`,
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

    const record = (role: string, object?: GameObject) => {
      const row = document.createElement('div');

      row.className = `telemetry-${role}`;

      if (!object) {
        row.textContent =
          role === 'player'
            ? 'Player: unavailable'
            : targetId === undefined
              ? 'Target: none selected'
              : 'Target: unavailable';
        rows.push(row);
        return;
      }

      const { id, position, rotation, velocity, spin, localMovementRate } =
        object;
      const parent =
        object.localMovementParent && entity(object.localMovementParent.id);
      const carried = parent && (localMovementRate || 0) > 0;

      row.append(
        ...lines(
          `${role === 'player' ? 'Player' : role === 'target' ? 'Target' : 'Parent'} #${id}\nPosition ${number(position.x)}\u2009/\u2009${number(position.y)} wu\nRotation ${number(rotation)} rad\nNative velocity ${number(velocity.x)}\u2009/\u2009${number(velocity.y)} wu/s\nNative spin ${number(spin)} rad/s`,
        ),
      );

      if (carried && role !== 'parent') {
        row.append(
          ...lines(
            `Carrier #${parent.id}\nlocalMovementRate ${number(localMovementRate!)}`,
          ),
        );

        if (parent !== player && parent !== target) {
          parents.set(parent.id, parent);
        }
      }

      rows.push(row);
    };

    record('player', player);
    record('target', target);
    parents.forEach((parent) => record('parent', parent));
    panel.replaceChildren(header, ...rows);
  };

  return {
    toggle() {
      enabled = !enabled;
      panel.hidden = !enabled;
      nextUpdate = 0;
    },
    update,
  };
};
