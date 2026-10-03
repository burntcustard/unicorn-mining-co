import { type SimulationEvent } from '../protocol/events';
import { playSound } from '../audio/sound-loader';
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
      sprayDamage({
        position: event.position,
        color: event.color,
        damage: event.damage,
      });
    } else if (
      event.type === 'asteroidSplit' ||
      event.type === 'asteroidDestroyed'
    ) {
      playSound(4);
    } else if (event.type === 'collision' && event.impact >= 40) {
      const damage = Math.min(4, event.impact / 40);

      event.colors.forEach((color) =>
        sprayDamage({ position: event.position, color, damage: damage / 2 }),
      );
    }
  });
