import * as Vec from '../utilities/vector';
import { type Craft } from '../objects/craft';
import { Ship } from '../objects/ship';
import { updateThrusterSound } from './sound-loader';

const voices = new Map<number, Parameters<typeof updateThrusterSound>[0]>();

/**
 * Keep one engine voice per ship across reconciliation, and retire removed ships.
 */
export const updateThrusterSounds = ({
  crafts,
  volume = () => 1,
}: {
  crafts: Iterable<Craft>;
  volume?: (craft: Craft) => number;
}) => {
  const playing = new Set<number>();

  for (const ship of crafts) {
    if (!(ship instanceof Ship)) continue;
    const turningSpeed =
      (ship.spin * 16) /
      (ship.turnRate * ship.rotationalThrust * ship.launchThrottle ** 2 || 1);
    const steeringEffort = Math.min(1, Math.abs(ship.turn - turningSpeed));
    const load = Math.min(
      1,
      Math.max(
        Vec.length(ship.velocity) / ship.maxSpeed,
        Math.abs(turningSpeed),
        steeringEffort * 0.65,
      ),
    );
    const engine = ship.engine;
    const power =
      !ship.dead && !ship.dockedTo && engine.mount
        ? Math.max(
            steeringEffort * ship.launchThrottle,
            ...ship.segments
              .filter((segment) => segment.module === engine)
              .map((segment) => segment.active),
          )
        : 0;

    const voice = updateThrusterSound(voices.get(ship.id), {
      power,
      load,
      volume: volume(ship),
    });

    if (voice) {
      voices.set(ship.id, voice);
    } else {
      voices.delete(ship.id);
    }

    playing.add(ship.id);
  }

  voices.forEach((voice, id) => {
    if (playing.has(id)) return;
    updateThrusterSound(voice, { power: 0 });
    voices.delete(id);
  });
};
