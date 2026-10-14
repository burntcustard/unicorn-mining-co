import { type WorldSound } from '../protocol/sounds';
import { remoteSoundVolume } from './remote-sound-volume';
import { playSound } from './sound-loader';
import * as Vec from '../utilities/vector';

/**
 * Play each authoritative gameplay sound with its source's volume multiplier.
 */
export const presentWorldSounds = ({
  sounds,
  playerId,
  view,
}: {
  sounds: WorldSound[];
  playerId?: number;
  view: { position: Vec.Value; width: number; height: number };
}) =>
  sounds.forEach((sound) =>
    playSound(sound.effect, {
      id: sound.id,
      by: sound.by,
      volume:
        sound.by === playerId
          ? 1
          : remoteSoundVolume({
              position: sound.position,
              view: view.position,
              width: view.width,
              height: view.height,
            }),
    }),
  );
