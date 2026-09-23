import { hit } from './hit';
import { type GameObject } from '../game-object';
import { collisionCategories, type Contact } from './types';

/* Read-only query for diagnostics; simulation contacts come from GameCollisions. */
export const detectCollisions = ({ entities }: { entities: GameObject[] }) => {
  const boxes = entities
    .flatMap((entity) => entity.hitboxes())
    .filter(({ collides }) => collides !== false);
  const contacts: Contact[] = [];

  boxes.forEach((a, index) =>
    boxes.slice(index + 1).forEach((b) => {
      if (
        a.owner === b.owner ||
        !(
          (a.collisionCategory ?? collisionCategories.solid) &
          (b.collisionMask ?? collisionCategories.solid)
        ) ||
        !(
          (b.collisionCategory ?? collisionCategories.solid) &
          (a.collisionMask ?? collisionCategories.solid)
        ) ||
        a.position.distanceTo(b.position) > a.radius + b.radius + 2
      ) {
        return;
      }
      const contact = hit(a, b);

      if (contact) {
        contacts.push({
          ...contact,
          collider: { ...a, ...contact.aPart },
          other: { ...b, ...contact.bPart },
        });
      }
    }),
  );
  return contacts;
};
