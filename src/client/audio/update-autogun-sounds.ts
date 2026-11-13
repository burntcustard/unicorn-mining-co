import type { Craft } from '../objects/craft';
import type { Weapon } from '../objects/modules/weapon';
import { updateAutogunSound } from './sound-loader';

/**
 * One motor and click timer per mount, outside rollback-owned module objects.
 */
export const createAutogunSoundUpdater = () => {
  const voices = new Map<string, ReturnType<typeof updateAutogunSound>>();

  return ({
    crafts,
    dt,
    volume = () => 1,
  }: {
    crafts: Iterable<Craft>;
    dt: number;
    volume?: (craft: Craft) => number;
  }) => {
    const playing = new Set<string>();

    for (const craft of crafts) {
      if (craft.dead || craft.dockedTo) continue;

      craft.mounts.forEach((mount, index) => {
        const gun = mount.module as Weapon;

        if (
          mount.health <= 0 ||
          !gun ||
          (gun.definitionId !== 'autogun' &&
            gun.definitionId !== 'autogunTurret')
        ) {
          return;
        }

        const segments = craft.segmentsAtMount(mount);
        const progress = Math.max(
          0,
          ...segments.map((segment) => segment.activationProgress),
        );

        if (!progress && !segments.some((segment) => segment.active === 1)) {
          return;
        }

        const key = `${craft.id}:${index}`;
        const previous = voices.get(key);
        const active = segments.some((segment) => segment.active === 1);
        const speed = active
          ? progress === 1
            ? Math.max(
                0,
                Math.min(1, 1 - gun.chargeCooldown / gun.chargeDuration),
              )
            : 0
          : Math.max(
              0,
              (previous?.speed ?? 0) - dt / (gun.dischargeDuration || 1),
            );
        const extension = Math.min(
          1,
          progress *
            (active
              ? 1
              : 1 + (gun.dischargeDuration || 0) / gun.activationDuration),
        );
        const multiplier = volume(craft) * 1.5625;

        const voice = updateAutogunSound(previous, {
          level: (extension * 0.15 + speed * 0.85) * multiplier,
          speed,
          interval: Math.max(0.1, gun.fireInterval),
          id: index,
          by: craft.id,
        });

        if (voice) {
          voices.set(key, voice);
        } else {
          voices.delete(key);
        }

        playing.add(key);
      });
    }

    voices.forEach((voice, key) => {
      if (playing.has(key)) return;
      updateAutogunSound(voice, { level: 0 });
      voices.delete(key);
    });
  };
};

export const updateAutogunSounds = createAutogunSoundUpdater();
