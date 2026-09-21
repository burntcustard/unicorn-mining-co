import { type Craft } from '../shared/craft/craft';
import { Horn } from '../shared/modules/horn';
import { continuousSound } from './sound-loader';

const voices = new Map<string, Parameters<typeof continuousSound>[0]>();

/**
 * Keep audio outside rollback-owned objects, and retire voices no longer present.
 */
export const updateDrillSounds = ({ crafts }: { crafts: Iterable<Craft> }) => {
  const playing = new Set<string>();

  for (const craft of crafts) {
    if (craft.dead) continue;
    craft.mounts.forEach((mount, mountIndex) => {
      if (!(mount.module instanceof Horn) || mount.health <= 0) return;
      craft.partsOf(mount).forEach((segment, partIndex) => {
        if (!segment.active) return;
        const key = `${craft.id}:${mountIndex}:${partIndex}`;
        const voice = continuousSound(voices.get(key), segment.biting ? 8 : 4);

        if (voice) voices.set(key, voice);
        playing.add(key);
      });
    });
  }

  voices.forEach((voice, key) => {
    if (playing.has(key)) return;
    continuousSound(voice, 0);
    voices.delete(key);
  });
};
