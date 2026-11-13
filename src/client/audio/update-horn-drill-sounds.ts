import settings from '../../specs/sounds/horn-drill';
import { type Craft } from '../objects/craft';
import { HornDrill } from '../objects/modules/horn-drill';
import { continuousSound } from './sound-loader';

const voices = new Map<string, Parameters<typeof continuousSound>[0]>();

/**
 * Keep audio outside rollback-owned objects, and retire voices no longer present.
 */
export const updateHornDrillSounds = ({
  crafts,
  volume = () => 1,
}: {
  crafts: Iterable<Craft>;
  volume?: (craft: Craft) => number;
}) => {
  const playing = new Set<string>();

  for (const craft of crafts) {
    if (craft.dead) continue;
    const multiplier = volume(craft);

    craft.mounts.forEach((mount, mountIndex) => {
      if (!(mount.module instanceof HornDrill) || mount.health <= 0) return;

      craft.segmentsAtMount(mount).forEach((segment, segmentIndex) => {
        if (!segment.active) return;
        const key = `${craft.id}:${mountIndex}:${segmentIndex}`;
        const voice = continuousSound(
          voices.get(key),
          (segment.biting ? settings.bitingVolume : settings.activeVolume) *
            multiplier,
          segment.biting ? settings.bitingPitch : settings.activePitch,
        );

        if (voice) {
          voices.set(key, voice);
        } else {
          voices.delete(key);
        }

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
