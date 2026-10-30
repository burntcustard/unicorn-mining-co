import type { ProtocolRuntime } from '../utilities/protocol-runtime.ts';

/*
 * Only the compiler fixture can confirm a trip's docking. A missing replicated
 * ship, ordinary dialogue, or another player's chat is not a completion signal.
 */
export function npcDocked(
  message: ReturnType<ProtocolRuntime['decodeServerControl']>,
) {
  if (message.type !== 'chat' || message.sender !== 'NPC benchmark') return;
  const match = /^\/npc-benchmark-docked (\d+) (\d+)$/.exec(message.text);

  if (!match) return;
  const id = Number(match[1]);
  const tick = Number(match[2]);

  if (Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(tick)) {
    return { id, tick };
  }
}

/*
 * Count observed work separately from rendered frames. Remote cargo changes
 * show pickup progress; authoritative fixture events confirm the actual work.
 */
export function npcObservations() {
  const records = new Map<
    number,
    {
      position: { x: number; y: number };
      samples: number;
      visible: number;
      path: number;
      cargo: number;
      states: Set<string>;
    }
  >();

  let samples = 0;
  let occupiedSamples = 0;
  let maximumActive = 0;

  return {
    observe({
      ships,
    }: {
      ships: {
        id: number;
        position: { x: number; y: number };
        cargo: number;
        state: string;
        visible: boolean;
      }[];
    }) {
      samples++;

      if (ships.length) occupiedSamples++;
      maximumActive = Math.max(maximumActive, ships.length);

      for (const ship of ships) {
        let record = records.get(ship.id);

        if (!record) {
          record = {
            position: { ...ship.position },
            samples: 0,
            visible: 0,
            path: 0,
            cargo: 0,
            states: new Set(),
          };

          records.set(ship.id, record);
        }

        record.path += Math.hypot(
          ship.position.x - record.position.x,
          ship.position.y - record.position.y,
        );
        Object.assign(record.position, ship.position);
        record.samples++;
        record.visible += Number(ship.visible);
        record.cargo = Math.max(record.cargo, ship.cargo);
        record.states.add(ship.state);
      }
    },
    summary() {
      return Object.fromEntries([
        ['samples', samples],
        ['occupied-samples', occupiedSamples],
        ['maximum-active', maximumActive],
        [
          'ships',
          [...records].map(([id, record]) =>
            Object.fromEntries([
              ['ship-id', id],
              ['samples', record.samples],
              ['visible-samples', record.visible],
              ['path-distance', record.path],
              ['maximum-cargo', record.cargo],
              ['states', [...record.states]],
            ]),
          ),
        ],
      ]);
    },
  };
}
