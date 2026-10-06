import { type SimulationEvent } from '../protocol/events';
import { playSound } from '../audio/sound-loader';
import { sprayDamage } from './shrapnel';
import { addEffect } from './effect';

/**
 * Present gameplay without running it again or putting audio into shared state.
 */
export const presentEvents = ({
  events,
  onMessage,
  playerId,
  shipId,
}: {
  events: SimulationEvent[];
  onMessage?: (note: { message: string; unlock?: string }) => void;
  playerId?: number;
  shipId?: number;
}) => {
  // A dedicated explosion replaces its source's generic damage sparks.
  // Collect first: a collision can precede the explosion in the same batch.
  const sources = new Set(
    events
      .filter((event) => event.type === 'explosion')
      .map((event) => event.objectId),
  );

  events.forEach((event) => {
    if (event.type === 'explosion') {
      addEffect({
        effect: event.effect,
        position: event.position,
      });
    } else if (event.type === 'itemCollected') {
      if (event.by !== playerId) return;

      playSound(2);

      if (event.message) {
        onMessage?.({ message: event.message, unlock: event.unlock });
      }
    } else if (
      event.type === 'drillDamage' ||
      event.type === 'objectDestroyed'
    ) {
      if (event.type === 'objectDestroyed' && sources.has(event.objectId)) {
        return;
      }

      sprayDamage({
        position: event.position,
        color: event.color,
        damage:
          event.type === 'objectDestroyed'
            ? Math.min(2, event.damage)
            : event.damage,
      });
    } else if (
      event.type === 'asteroidSplit' ||
      event.type === 'asteroidDestroyed'
    ) {
      playSound(4);
    } else if (event.type === 'collision') {
      if (
        event.impact >= 40 &&
        ((event.a === shipId && event.damage[0] > 0) ||
          (event.b === shipId && event.damage[1] > 0))
      ) {
        playSound(3);
      }

      event.colors.forEach((color, index) => {
        if (
          event.damage[index] > 0 &&
          !sources.has(index ? event.b : event.a)
        ) {
          sprayDamage({
            position: event.position,
            color,
            damage: Math.min(2, event.damage[index]),
          });
        }
      });
    }
  });
};
