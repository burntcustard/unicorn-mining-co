import { type SimulationEvent } from '../shared/protocol/events';
import { colors } from '../shared/colors';
import { playSound } from './sound-loader';
import { sprayDamage } from './shrapnel';

/**
 * Present gameplay without running it again or putting audio into shared state.
 */
export const presentEvents = ({
  events,
  onMessage,
  playerId,
}: {
  events: SimulationEvent[];
  onMessage?: (note: { message: string; unlock?: string }) => void;
  playerId?: number;
}) =>
  events.forEach((event) => {
    if (event.type === 'itemCollected') {
      if (event.by !== playerId) return;

      playSound(2);

      if (event.message) {
        onMessage?.({ message: event.message, unlock: event.unlock });
      }
    } else if (event.type === 'drillDamage') {
      const color = event.resource === 1 ? colors.violet[2] : colors.white[2];

      sprayDamage({ position: event.position, color, damage: event.damage });
    } else if (
      event.type === 'asteroidSplit' ||
      event.type === 'asteroidDestroyed'
    ) {
      playSound(4);
    } else if (event.type === 'collision' && event.impact >= 40) {
      sprayDamage({
        position: event.position,
        color: colors.white[2],
        damage: Math.min(4, event.impact / 40),
      });
    }
  });
